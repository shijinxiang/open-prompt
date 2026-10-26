const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const vm = require('vm')
const script = fs.readFileSync(path.join(__dirname, '..', '专家填写助手-v1.5.1-排序与二轮修复版/Chrome扩展/bindings.js'), 'utf8')
const context = vm.createContext({ console })
vm.runInContext(script, context)
const area = (initial = {}) => {
  const data = structuredClone(initial)
  return { data, async get(keys) { return Object.fromEntries((typeof keys === 'string' ? [keys] : keys).filter(key => key in data).map(key => [key, structuredClone(data[key])])) }, async set(values) { Object.assign(data, structuredClone(values)) } }
}
const setup = (local = {}, session = {}) => {
  const storage = { local: area(local), session: area(session) }
  const rows = new Map(['a', 'b', 'archived'].map(id => [id, { id, archived: id === 'archived' }]))
  const db = { get: async id => rows.get(id), isArchived: row => !!row.archived }
  return { storage, db, service: context.QFBindings.create({ storage, db }) }
}
test('first import wins, explicit manual replacement is durable across tab/session restart', async () => {
  const { storage, db, service } = setup()
  const first = await service.bind('900000000101', 'a')
  assert.equal((await service.bind('900000000101', 'b')).draftId, 'a')
  const changed = await service.bind('900000000101', 'b', true)
  assert.equal(changed.firstDraftId, 'a')
  assert.equal(changed.revision, 2)
  storage.session.data.questionDraftBindings = {}
  assert.equal((await context.QFBindings.create({ storage, db }).all())['900000000101'].draftId, 'b')
  await assert.rejects(service.verify('900000000101', 'a', first.revision), /绑定已更改/)
})
test('concurrent first imports cannot overwrite the winner', async () => {
  const { service } = setup()
  const results = await Promise.all([service.bind('900000000102', 'a'), service.bind('900000000102', 'b')])
  assert.equal(new Set(results.map(result => result.draftId)).size, 1)
  assert.equal((await service.all())['900000000102'].draftId, results[0].draftId)
})

test('shared libraries keep separate bindings and migrate canonical aliases without changing local bindings', async () => {
  let current={enabled:true,libraryId:'library-one'}
  const isolated=vm.createContext({console,QFShared:{config:async()=>current}});vm.runInContext(script,isolated)
  const storage={local:area({questionRecordBindingsVersion:1,questionRecordBindings:{'900000000201':{draftId:'oqs-a',firstDraftId:'oqs-a',revision:1}}}),session:area()}
  const db={get:async id=>['a','oqs-a','b'].includes(id)?{id:id==='oqs-a'?'a':id,archived:false}:null,isArchived:row=>row.archived}
  const service=isolated.QFBindings.create({storage,db})
  assert.equal((await service.all())['900000000201'].draftId,'a')
  await service.bind('900000000201','b',true)
  assert.equal(storage.local.data.questionRecordBindings['900000000201'].draftId,'oqs-a')
  current={enabled:true,libraryId:'library-two'}
  assert.equal((await service.all())['900000000201'].draftId,'a')
  current={enabled:true,libraryId:'library-one'}
  assert.equal((await service.all())['900000000201'].draftId,'b')
  current={enabled:false}
  assert.equal((await service.all())['900000000201'].draftId,'oqs-a')
})
test('legacy bindings migrate and report history only fills missing question associations', async () => {
  const { service } = setup({ reportsByTarget: { first: { at: 1, questionId: '900000000101', draftId: 'a' }, other: { at: 2, questionId: '900000000102', draftId: 'a' } } }, { questionDraftBindings: { '4:900000000101': { draftId: 'b' } } })
  const bindings = await service.all()
  assert.equal(bindings['900000000101'].draftId, 'b')
  assert.equal(bindings['900000000102'].draftId, 'a')
})
test('invalid, missing and archived records do not create a binding; deletion forgets it', async () => {
  const { service } = setup()
  await assert.rejects(service.bind('bad', 'a'), /无效/)
  await assert.rejects(service.bind('900000000101', 'missing'), /已删除/)
  await assert.rejects(service.bind('900000000101', 'archived'), /已归档/)
  assert.equal(Object.keys(await service.all()).length, 0)
  await service.bind('900000000101', 'a')
  await service.forget('a')
  assert.equal(Object.keys(await service.all()).length, 0)
})
