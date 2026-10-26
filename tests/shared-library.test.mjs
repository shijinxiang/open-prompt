import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createRecord, mergeRecordLists } from '../src/domain.js'
import * as domain from '../src/domain.js'
const require=createRequire(import.meta.url)
const {createStorage}=require('../electron/storage.cjs')
const {createRepository,sharedIdentity}=require('../electron/shared-repository.cjs')
const {startSharedBridge}=require('../electron/shared-bridge.cjs')

test('three way desktop merge preserves independent edits, archive and deletion',()=>{
  const base=createRecord(),local=structuredClone(base),remote=structuredClone(base)
  local.prompt='desktop';remote.archived=true;remote.models.doubao.note='plugin'
  const merged=mergeRecordLists([base],[local],[remote]);assert.equal(merged.conflicts.length,0)
  assert.equal(merged.records[0].prompt,'desktop');assert.equal(merged.records[0].archived,true);assert.equal(merged.records[0].models.doubao.note,'plugin')
  assert.deepEqual(mergeRecordLists([base],[base],[]).records,[])
  assert.equal(mergeRecordLists([base],[local],[]).conflicts.length,1)
  remote.prompt='other';assert.equal(mergeRecordLists([base],[local],[remote]).conflicts[0].path,'prompt')
  assert.equal(mergeRecordLists([base],[local],[remote],false).records[0].prompt,'other')
})

test('authenticated loopback repository shares archive, patches, images, imports and conflicts',async()=>{
  const folder=await mkdtemp(path.resolve('test-results/shared-api-')),storage=createStorage(path.join(folder,'data'))
  const row=createRecord();row.title='Shared';await storage.save({version:4,records:[row]})
  const repository=createRepository({storage,domain}),identity=await sharedIdentity(storage,path.join(folder,'cache')),bridge=await startSharedBridge({repository,identity,port:0})
  const base=`http://127.0.0.1:${bridge.port}/v1/`
  const call=async(route,data,headers={})=>{const res=await fetch(base+route,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+identity.token,...(data?{'Content-Type':'application/json'}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});return {status:res.status,data:await res.json()}}
  try{
    assert.equal((await fetch(base+'info')).status,401)
    assert.equal((await call('info',null,{Origin:'https://evil.example'})).status,403)
    assert.equal((await call('info',null,{Origin:'chrome-extension://'+'a'.repeat(32)})).data.libraryId,identity.libraryId)
    const before=(await repository.read()).records
    assert.equal((await call(`records/${row.id}/archive`,{archived:true})).status,200)
    const mine=structuredClone(before);mine[0].prompt='pending desktop input';await repository.mergeSnapshot(before,mine)
    const patch=await call(`records/${row.id}/patch`,{changes:[{path:['models','doubao','note'],before:'',after:'plugin note'}]});assert.equal(patch.status,200)
    const latest=(await repository.read()).records[0];assert.equal(latest.archived,true);assert.equal(latest.prompt,'pending desktop input');assert.equal(latest.models.doubao.note,'plugin note')
    const conflict=await call(`records/${row.id}/patch`,{changes:[{path:['prompt'],before:'',after:'stale plugin'}]});assert.equal(conflict.status,409)
    assert.equal((await repository.read()).records[0].prompt,'pending desktop input')
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
    const custom=createRecord();custom.models.doubao.screenshots=[{id:crypto.randomUUID(),name:'test.png',dataUrl:png}]
    assert.equal((await call('import',{records:[custom]})).data.count,1)
    assert.equal((await call('import',{records:[custom]})).data.skipped,1)
    const saved=(await call('records/'+custom.id)).data.record.models.doubao.screenshots[0];assert.ok(saved.fileName);assert.equal(saved.dataUrl,undefined)
    const embedded=(await call('records/'+custom.id+'?images=1')).data.record.models.doubao.screenshots[0];assert.equal(embedded.dataUrl,png)
    assert.equal((await readFile(path.join(storage.attachments,saved.fileName))).length,Buffer.from(png.split(',')[1],'base64').length)
    assert.equal((await call(`records/${row.id}/delete`,{revision:'stale'})).status,409)
    const current=(await call('records/'+row.id)).data
    assert.equal((await call(`records/${row.id}/delete`,{revision:current.revision})).status,200)
    assert.equal((await call(`records/${row.id}/patch`,{changes:[]})).status,404)
    assert.equal((await sharedIdentity(storage,path.join(folder,'cache'))).token,identity.token)
  }finally{repository.close();await bridge.close()}
})
