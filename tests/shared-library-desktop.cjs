const {_electron:electron,chromium}=require('playwright')
const fs=require('fs/promises'),path=require('path'),http=require('http'),assert=require('node:assert/strict')
const {createStorage}=require('../electron/storage.cjs')
const {createBackground,platformHTML}=require('./helpers/fill-platform-harness.cjs')
async function main(){
  const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(root,'test-results','shared-desktop-')),extension=path.join(root,'专家填写助手-v1.5.1-排序与二轮修复版','Chrome扩展')
  const {createRecord}=await import('../src/domain.js'),row=createRecord();row.title='共享测试题';row.prompt='原问题';row.tags='保留标签';row.quality.ranking='未整理的原排序'
  const storage=createStorage(dir),png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2HsAAAAASUVORK5CYII='
  row.models.doubao.screenshots=[{...await storage.saveAttachment({dataUrl:png,originalName:'共享.png'}),id:crypto.randomUUID(),name:'共享.png'}];await storage.save({version:4,records:[row]})
  const env={...process.env,OQS_TEST_DATA:dir,OQS_USE_BUILD:'1'};delete env.ELECTRON_RUN_AS_NODE
  const app=await electron.launch({args:[root],executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),env}),errors=[]
  const server=http.createServer(async(req,res)=>{try{const file=path.resolve(extension,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(extension+path.sep))throw Error('path');res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html;charset=utf-8','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file))}catch{res.writeHead(404);res.end()}})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser
  try{
    const desktop=await app.firstWindow();desktop.on('pageerror',e=>errors.push(e.message));await desktop.getByPlaceholder('记录标题').waitFor()
    const info=await desktop.evaluate(()=>desktopApi.sharedInfo());assert.equal(info.available,true)
    browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true})
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}/app.html`)
    await page.waitForFunction(()=>!!document.querySelector('[data-field]'))
    await page.locator('#sharedCode').fill(info.pairingCode);await page.locator('#sharedConnect').click();await page.waitForFunction(id=>typeof draft!=='undefined'&&draft?.id===id,row.id)
    assert.equal(await page.locator('#f-question-input').inputValue(),'原问题');assert.equal(await page.locator('#files-doubao-screenshot-file-input .file-item').count(),1)
    assert.equal(await page.evaluate(async()=> (await QFShared.local.all()).length),1,'shared records are not duplicated in plugin IndexedDB')
    await page.locator('#archiveDraft').click();await desktop.getByRole('button',{name:'恢复记录',exact:true}).waitFor()
    await desktop.getByRole('button',{name:'恢复记录',exact:true}).click();await desktop.locator('.save-indicator.saved').waitFor();await page.waitForFunction(()=>draft.archived===false)
    await page.locator('#f-doubao-achievement-note-input').fill('插件修改备注');await desktop.getByLabel('豆包专家达成性备注',{exact:true}).filter({}).waitFor();await desktop.waitForFunction(()=>document.querySelector('#section-doubao .note-input').value==='插件修改备注')
    await desktop.getByLabel('关键洞察（Insight）').fill('存题软件修改洞察');await desktop.locator('.save-indicator.saved').waitFor();await page.waitForFunction(()=>document.getElementById('f-insight-input').value==='存题软件修改洞察')
    // Two stale clients edit different fields; neither may revert the other or archive.
    await page.evaluate(async id=>{const a=await QFDB.get(id),b=await QFDB.get(id);await QFDB.setArchived(id,true);a.values['question-input']='插件新问题';b.values['insight-description-input']='独立考点';await Promise.all([QFDB.put(a),QFDB.put(b)]);},row.id)
    let saved=(await storage.load()).records[0];assert.equal(saved.archived,true);assert.equal(saved.prompt,'插件新问题');assert.equal(saved.criteriaText,'独立考点');assert.equal(saved.tags,'保留标签');assert.equal(saved.quality.ranking,'未整理的原排序')
    // Same-field conflict is explicit, original content survives, pending edit is durable.
    await page.evaluate(async id=>{const stale=await QFDB.get(id),fresh=await QFDB.get(id);fresh.values['question-input']='最新题目';await QFDB.put(fresh);stale.values['question-input']='冲突修改';try{await QFDB.put(stale);throw Error('expected conflict')}catch(e){if(e.code!=='SHARED_CONFLICT')throw e;}if(!(await QFShared.pending(id)))throw Error('pending missing');},row.id)
    assert.equal((await storage.load()).records[0].prompt,'最新题目')
    await page.reload();await page.locator('#sharedConflict').waitFor({state:'visible'});await page.locator('#sharedUseRemote').click();await page.waitForFunction(()=>document.getElementById('sharedConflict').hidden);assert.equal(await page.locator('#f-question-input').inputValue(),'最新题目')
    const custom=createRecord();custom.title='自定义JSON题';custom.models.doubao.screenshots=[{id:crypto.randomUUID(),name:'导入.png',dataUrl:png}]
    await page.locator('#importFile').setInputFiles({name:'自定义.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:4,records:[custom]}))});await page.locator('#libraryImportNotice').filter({hasText:'导入 1 条，跳过 0 条'}).waitFor()
    assert.equal((await storage.load()).records.length,2);assert.equal(await page.locator('#draftName').inputValue(),'自定义JSON题')
    const snapshot=await page.evaluate(()=>QFPortable.pack([draft],draft.id));assert.equal(JSON.stringify(snapshot).includes('_shared'),false);assert.equal(JSON.stringify(snapshot).includes(info.pairingCode),false)
    // Slow saves + further keystrokes: only the latest text should remain, with no false conflict.
    await page.route(`http://127.0.0.1:${info.port}/v1/records/*/patch`,async route=>{await new Promise(resolve=>setTimeout(resolve,250));await route.continue()})
    await page.locator('#f-insight-input').fill('连续输入第一段');await page.waitForTimeout(210);await page.locator('#f-insight-input').fill('连续输入最终版本');await page.evaluate(()=>saveNow());await page.waitForFunction(()=>document.getElementById('saveState').textContent==='已在本机保存')
    assert.equal((await storage.load()).records.find(r=>r.id===custom.id).insight,'连续输入最终版本');assert.equal(await page.locator('#sharedConflict').isVisible(),false)
    await page.unroute(`http://127.0.0.1:${info.port}/v1/records/*/patch`)
    const context=await browser.newContext();await context.route('https://aidp.bytedance.com/**',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:platformHTML(extension,'900000000301',['900000000301','900000000302'])}))
    const bg=createBackground(extension,context,[]),parts=info.pairingCode.split(':');await bg.storage.local.set({sharedLibrary:{enabled:true,port:Number(parts[2]),libraryId:parts[3],token:parts[4]},activeDraftId:custom.id})
    const platform=await context.newPage(),tabId=bg.register(platform);await platform.goto('https://aidp.bytedance.com/task?itemID=900000000301')
    const filled=await bg.dispatch({type:'qf-fill',draftId:custom.id,targetKey:tabId+':900000000301'});assert.equal(filled.ok,true,filled.error)
    const scoped=(await bg.storage.local.get('questionRecordBindings:shared:'+parts[3]))['questionRecordBindings:shared:'+parts[3]];assert.equal(scoped['900000000301'].draftId,custom.id)
    await platform.exposeFunction('__platformMessage',message=>bg.dispatch(message,{tab:{id:tabId}}));await platform.evaluate(()=>{globalThis.chrome={runtime:{sendMessage:message=>__platformMessage(message)}}});await platform.addScriptTag({path:path.join(extension,'question-probe.js')});await platform.addScriptTag({path:path.join(extension,'platform-watch.js')})
    await platform.locator('#submitMock').click();await page.waitForFunction(()=>draft.archived===true);assert.equal((await storage.load()).records.find(r=>r.id===custom.id).archived,true)
    await context.close()
    // Offline edits are a recovery outbox, never a silent second database.
    await page.route(`http://127.0.0.1:${info.port}/**`,route=>route.abort())
    await page.locator('#f-insight-input').fill('离线未保存修改');await page.evaluate(async()=>{try{await saveNow();}catch{}});await page.waitForFunction(async()=>!!await QFShared.pending(draft.id))
    assert.equal((await storage.load()).records.find(r=>r.id===custom.id).insight,'连续输入最终版本')
    assert.equal(await page.evaluate(async()=> (await QFShared.local.all()).length),1)
    await page.reload();await page.waitForFunction(()=>document.getElementById('saveState').textContent.includes('初始化失败'))
    await page.unroute(`http://127.0.0.1:${info.port}/**`);await page.bringToFront();await page.waitForFunction(()=>typeof draft!=='undefined'&&draft?.values['insight-input']==='离线未保存修改').catch(async e=>{console.log('Recovery diagnostics',await page.evaluate(async()=>({hidden:document.hidden,state:document.getElementById('saveState').textContent,status:document.getElementById('sharedStatus').textContent,hasDraft:!!draft,value:draft?.values['insight-input'],active:localStorage.getItem('qf_activeDraftId'),pending:!!await QFShared.pending(JSON.parse(localStorage.getItem('qf_activeDraftId')))})));throw e;});await page.waitForFunction(()=>document.getElementById('saveState').textContent==='已在本机保存')
    assert.equal((await storage.load()).records.find(r=>r.id===custom.id).insight,'离线未保存修改')
    await page.screenshot({path:path.join(dir,'shared-plugin.png'),fullPage:false});await desktop.screenshot({path:path.join(dir,'shared-desktop.png')})
    assert.deepEqual(errors,[]);console.log('PASS shared desktop + plugin: bidirectional archive/content, stale saves, conflict recovery, images and custom JSON')
  }finally{await browser?.close();await app.close();await new Promise(resolve=>server.close(resolve))}
}
main().catch(e=>{console.error(e);process.exitCode=1})
