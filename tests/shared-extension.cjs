const {_electron:electron,chromium}=require('playwright')
const path=require('path'),fs=require('fs/promises'),assert=require('node:assert/strict')
const {createStorage}=require('../electron/storage.cjs')
const {platformHTML}=require('./helpers/fill-platform-harness.cjs')
async function main(){
  const root=path.resolve(__dirname,'..'),dir=await fs.mkdtemp(path.join(root,'test-results','shared-native-')),extension=path.join(root,'专家填写助手-v1.5.1-排序与二轮修复版','Chrome扩展')
  const {createRecord}=await import('../src/domain.js'),row=createRecord();row.title='真实扩展共享验证';row.prompt='测试题目正文';row.models.doubao.response='原始回复'
  row.models.model4.actualName='gemini-3-flash-grounding';row.models.model4.response='二轮模型4完整原文';row.models.model5.actualName='grok-4.5-search';row.models.model5.response='二轮模型5完整原文';row.quality={enabled:true,ranking:'GPT-5.6-Sol＝grok-4.5-search ＞ gemini-3-flash-grounding ＞ 豆包专家＝Opus 4.6',rankingExplanation:'保留完整的二轮排序说明。'}
  const storage=createStorage(path.join(dir,'data'));await storage.save({version:4,records:[row]})
  const env={...process.env,OQS_TEST_DATA:storage.root};delete env.ELECTRON_RUN_AS_NODE
  const app=await electron.launch({executablePath:path.join(root,'release/win-unpacked/开放题标注工作台.exe'),env});let browser
  try{
    const desktop=await app.firstWindow();await desktop.getByPlaceholder('记录标题').waitFor();const info=await desktop.evaluate(()=>desktopApi.sharedInfo());assert.equal(info.available,true)
    await desktop.getByRole('button',{name:'设置',exact:true}).click();await desktop.getByRole('button',{name:'复制共享题库连接码',exact:true}).waitFor();await desktop.screenshot({path:path.join(dir,'shared-settings.png')});await desktop.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click()
    browser=await chromium.launchPersistentContext(path.join(dir,'chrome'),{executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-unsafe-extension-debugging'],ignoreDefaultArgs:['--disable-extensions']})
    const cdp=await browser.browser().newBrowserCDPSession(),loaded=await cdp.send('Extensions.loadUnpacked',{path:extension});assert.match(loaded.id,/^[a-p]{32}$/)
    const editor=await browser.newPage(),errors=[];editor.on('pageerror',e=>errors.push(e.message));await editor.goto('chrome-extension://'+loaded.id+'/app.html');await editor.waitForFunction(()=>!!document.querySelector('[data-field]'))
    await editor.locator('#sharedCode').fill(info.pairingCode);await editor.locator('#sharedConnect').click();await editor.waitForFunction(id=>typeof draft!=='undefined'&&draft?.id===id,row.id)
    assert.equal(await editor.locator('#f-question-input').inputValue(),row.prompt)
    assert.deepEqual(await editor.locator('[data-rank]').evaluateAll(elements=>elements.map(el=>el.value)),['3','1','3','2','1']);assert.equal(await editor.locator('#syncRanking').isChecked(),true)
    await editor.locator('#syncRanking').uncheck();await editor.evaluate(()=>saveNow());assert.equal(await desktop.getByRole('switch',{name:'二轮资料',exact:true}).isChecked(),true);assert.equal(await desktop.getByLabel('模型4原始回复',{exact:true}).inputValue(),row.models.model4.response)
    assert.deepEqual((await storage.load()).records[0].quality,row.quality)
    await editor.reload();await editor.waitForFunction(id=>typeof draft!=='undefined'&&draft?.id===id,row.id);assert.equal(await editor.locator('#syncRanking').isChecked(),false)
    await editor.locator('#syncRanking').check();await editor.evaluate(()=>saveNow())
    const workers=browser.serviceWorkers(),worker=workers.find(value=>value.url().startsWith('chrome-extension://'+loaded.id));assert.ok(worker,'native MV3 worker started')
    assert.equal(await worker.evaluate(async id=>(await QFDB.get(id)).name,row.id),row.title)
    await editor.locator('#archiveDraft').click();await desktop.getByRole('button',{name:'恢复记录',exact:true}).waitFor();await editor.locator('#archiveDraft').click();await desktop.getByRole('button',{name:'归档记录',exact:true}).waitFor()
    const questionId='900000000401';await browser.route('https://aidp.bytedance.com/**',async route=>{const pathname=new URL(route.request().url()).pathname;if(/\.(js|css|png|json)$/.test(pathname)){try{return await route.fulfill({body:await fs.readFile(path.join(extension,path.basename(pathname))),contentType:pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':'application/octet-stream'})}catch{return route.fulfill({status:404,body:''})}}return route.fulfill({contentType:'text/html;charset=utf-8',body:platformHTML(extension,questionId,[questionId])})})
    const platform=await browser.newPage();platform.on('pageerror',e=>errors.push(e.message));await platform.goto('https://aidp.bytedance.com/task?itemID='+questionId)
    const result=await editor.evaluate(async({id,questionId})=>{const [tab]=await chrome.tabs.query({url:'https://aidp.bytedance.com/*'});return chrome.runtime.sendMessage({type:'qf-fill',draftId:id,targetKey:tab.id+':'+questionId});},{id:row.id,questionId});assert.equal(result.ok,true,result.error)
    assert.equal(await platform.locator('[data-field-id=question-input]').inputValue(),row.prompt)
    assert.equal(await platform.locator('[data-field-id=arena1-markdown-input]').inputValue(),row.models.model4.response);assert.equal(await platform.locator('[data-field-id=arena2-markdown-input]').inputValue(),row.models.model5.response)
    assert.deepEqual(await platform.locator('[data-field-id^="ranking-group-"]').evaluateAll(groups=>groups.map(group=>[...group.querySelectorAll('[data-field-id^="ranking-drag-"]')].map(el=>el.dataset.fieldId.replace('ranking-drag-','')).sort())),[['arena2','gpt56'],['arena1'],['claude','doubao']])
    assert.deepEqual((await storage.load()).records[0].quality,row.quality);assert.equal(await desktop.getByRole('switch',{name:'二轮资料',exact:true}).isChecked(),true)
    await platform.locator('#submitMock').click();await desktop.getByRole('button',{name:'恢复记录',exact:true}).waitFor();assert.equal((await storage.load()).records[0].archived,true)
    assert.deepEqual(errors,[]);console.log('PASS real Chrome extension: named/full-width rankings, independent sync preference, unchanged desktop second-round state, webpage filling and archive sync')
  }finally{await browser?.close();await app.close()}
}
main().catch(e=>{console.error(e);process.exitCode=1})
