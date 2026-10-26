importScripts('schema.js','db.js','library-import.js','shared-map.js','shared-db.js','engine.js','tabs.js','question-probe.js','bindings.js');
const running=new Set(),runningQuestions=new Set(),bindingChanges=new Set();
const bindings=QFBindings.create({storage:chrome.storage,db:QFDB});
let platformRevision=0;
const changed=async()=>chrome.storage.session.set({platformRevision:++platformRevision+'-'+Date.now()});
let writeQueue=Promise.resolve();
function serial(work){const result=writeQueue.catch(()=>{}).then(work);writeQueue=result;return result;}
function cleanTargets(value={}){return Object.fromEntries(Object.entries(value).filter(([,key])=>typeof key==='string'&&/^\d+:\d{12,24}$/.test(key)));}
async function platformTab(tabId){const tab=await chrome.tabs.get(tabId);if(!QFTabs.allowed(tab))throw Error('只支持“AI数据服务平台”标签页，其他网页不会读取或填写。');return tab;}
async function probe(tabId,options={}){
  await platformTab(tabId);
  const request=chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',func:qualityQuestionProbe,args:[options]});
  let timer;const result=options.action==='select'?await request:await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('平台页面响应较慢，请稍后刷新题号')),2500);})]).finally(()=>clearTimeout(timer));
  const value=result[0]?.result;
  if(!value?.allowed)throw Error('目标不是AI数据服务平台，已停止操作');
  if(value.error)throw Error(value.error);return value;
}
async function verifyQuestion(targetKey,currentOnly=true){
  const target=QFTabs.parse(targetKey);const result=await probe(target.tabId,{action:'select',questionId:target.questionId,currentOnly});
  if(!result.selected||result.questionId!==target.questionId)throw Error('未确认目标题号，已停止填写');return {...target,targetKey};
}
const scanCache=new Map();
async function scanTab(tab,force=false){
  const signature=tab.url+'|'+tab.title,old=scanCache.get(tab.id);
  if(old?.signature===signature&&!force){if(old.pending)return old.pending;if(old.value&&Date.now()-old.at<2000)return old.value;}
  const entry={signature,at:Date.now()};
  entry.pending=probe(tab.id).then(scan=>{const value={tab,scan};if(scanCache.get(tab.id)===entry){entry.value=value;entry.pending=null;entry.at=Date.now();}return value;}).catch(e=>{if(scanCache.get(tab.id)===entry)scanCache.delete(tab.id);throw e;});
  scanCache.set(tab.id,entry);return entry.pending;
}
async function platformScans(force=false){
  const platform=(await chrome.tabs.query({url:QFTabs.pattern})).filter(QFTabs.allowed).sort((a,b)=>(a.windowId-b.windowId)||(a.index-b.index));
  const open=new Set(platform.map(t=>t.id));for(const id of scanCache.keys())if(!open.has(id))scanCache.delete(id);
  const scans=await Promise.allSettled(platform.map(tab=>scanTab(tab,force)));
  return scans.filter(r=>r.status==='fulfilled').map(r=>r.value);
}
async function identityTarget(tabId,questionId){
  const scan=await probe(tabId,{action:'identity'});
  if(scan.currentQuestionId===questionId&&scan.consistent&&scan.loading)return verifyQuestion(QFTabs.key(tabId,questionId),false);
  if(scan.currentQuestionId!==questionId||!scan.consistent||scan.currentUnavailable)return null;
  if(running.has(tabId))throw Error('该题目正在补填，请稍后再选');
  return {tabId,questionId,targetKey:QFTabs.key(tabId,questionId)};
}
async function waitForNewTab(tabId){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){
    let tab;try{tab=await chrome.tabs.get(tabId);}catch{throw Error('新建的题目标签页已关闭，请重新选择题号');}
    if(tab.status!=='loading'&&QFTabs.allowed(tab))return tab;
    if(tab.status==='complete'&&!QFTabs.allowed(tab))throw Error('新标签页尚未进入AI数据服务平台，请在该页完成登录或检查页面后刷新题号');
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw Error('新标签页加载超时，原页面已保留。请查看新页面后刷新题号再试');
}
const questionResolutions=new Map();
async function ensureQuestion(targetKey){
  const requested=QFTabs.parse(targetKey);
  try{const direct=await identityTarget(requested.tabId,requested.questionId);if(direct)return direct;}catch(e){if(running.has(requested.tabId))throw e;}
  const existing=questionResolutions.get(requested.questionId);if(existing)return existing;
  const work=(async()=>{
    const platform=(await chrome.tabs.query({url:QFTabs.pattern})).filter(QFTabs.allowed);
    // URL hints choose candidates; a live DOM/header check always confirms them.
    for(const tab of platform){
      if(tab.id===requested.tabId)continue;
      const url=new URL(tab.url);if(!['itemID','itemId','item_id','questionId','question_id'].some(k=>url.searchParams.get(k)===requested.questionId))continue;
      try{const target=await identityTarget(tab.id,requested.questionId);if(target)return target;}catch(e){if(running.has(tab.id))throw e;}
    }
    let source=null;
    const requestedTab=platform.find(t=>t.id===requested.tabId);
    if(requestedTab){try{const value=await scanTab(requestedTab);if(value.scan.questions?.some(q=>q.questionId===requested.questionId))source=value;}catch{}}
    if(!source){
      const scans=await platformScans();
      for(const value of scans)if(value.scan.currentQuestionId===requested.questionId){const target=await identityTarget(value.tab.id,requested.questionId);if(target)return target;}
      source=scans.find(({scan})=>scan.questions?.some(q=>q.questionId===requested.questionId));
    }
    if(!source)throw Error('平台左侧尚未加载这个题号，请先在平台加载并刷新题号');
    const tab=await chrome.tabs.create({url:QFTabs.questionURL(source.tab,source.scan,requested.questionId),windowId:source.tab.windowId,openerTabId:source.tab.id,active:false});
    await waitForNewTab(tab.id);
    const target=await verifyQuestion(QFTabs.key(tab.id,requested.questionId),false);scanCache.delete(tab.id);return target;
  })();
  questionResolutions.set(requested.questionId,work);
  try{return await work;}finally{if(questionResolutions.get(requested.questionId)===work)questionResolutions.delete(requested.questionId);}
}
async function archiveCompleted(scans){
  const retired=new Set(scans.flatMap(value=>value.scan.retiredQuestionIds||[]));if(!retired.size)return;
  const bound=await bindings.all();
  for(const id of retired){const recordId=bound[id]?.draftId;if(!recordId)continue;const row=await QFDB.get(recordId);if(row&&!QFDB.isArchived(row))await QFDB.setArchived(recordId,true);}
}
async function questionTargets(force=false){
  const rawScans=await platformScans(force),{platformSelections={}}=await chrome.storage.session.get('platformSelections');
  const scans=rawScans.map(value=>({...value,tab:{...value.tab,recentPlatform:platformSelections[value.tab.windowId]?.tabId===value.tab.id}}));await archiveCompleted(scans);
  const bound=await bindings.all(),summaries=new Map((await QFDB.summaries()).map(row=>[row.id,row]));
  const targets=QFTabs.targets(scans).filter(target=>!bound[target.questionId]||summaries.has(bound[target.questionId].draftId)&&!QFDB.isArchived(summaries.get(bound[target.questionId].draftId)));
  return serial(async()=>{
    const {draftTargets={}}=await chrome.storage.session.get('draftTargets'),assignments=cleanTargets(draftTargets);
    for(const [draft,key]of Object.entries(assignments)){
      const questionId=QFTabs.parse(key).questionId,matches=targets.filter(target=>target.questionId===questionId);
      if(!matches.length||!summaries.has(draft)||QFDB.isArchived(summaries.get(draft))||bound[questionId]&&bound[questionId].draftId!==draft){delete assignments[draft];continue;}
      if(!targets.some(target=>target.id===key))assignments[draft]=matches[0].id;
    }
    if(JSON.stringify(assignments)!==JSON.stringify(draftTargets))await chrome.storage.session.set({draftTargets:assignments});
    return {tabs:targets,draftTargets:assignments,questionBindings:Object.fromEntries(Object.entries(bound).map(([id,value])=>[id,value.draftId]))};
  });
}
const targetVersions=new Map();
async function selectTarget(draftId,targetKey,editorId){
  if(!draftId)throw Error('请先选择记录');
  const editor=editorId||draftId,version=(targetVersions.get(editor)||0)+1;targetVersions.set(editor,version);
  const resolved=targetKey?await ensureQuestion(targetKey):null;
  const bound=await bindings.all(),questionId=resolved?.questionId,selectedId=questionId&&bound[questionId]?.draftId||draftId;
  const row=await QFDB.get(selectedId);if(!row)throw Error('绑定记录已删除，请手动选择其他记录');
  if(resolved&&QFDB.isArchived(row))throw Error('该题号对应记录已归档，请刷新题号');
  return serial(async()=>{
    const stored=await chrome.storage.session.get('draftTargets'),draftTargets=cleanTargets(stored.draftTargets);
    if(targetVersions.get(editor)!==version)return {stale:true,draftTargets};
    if(resolved)draftTargets[selectedId]=resolved.targetKey;else delete draftTargets[draftId];
    await chrome.storage.session.set({draftTargets});
    return {draftTargets,draftId:selectedId,targetKey:resolved?.targetKey||null,bound:!!bound[questionId],target:resolved?{id:resolved.targetKey,tabId:resolved.tabId,questionId,current:true,label:questionId}:null};
  });
}
async function manualBind(draftId,targetKey){
  const resolved=await ensureQuestion(targetKey);if(runningQuestions.has(resolved.questionId)||bindingChanges.has(resolved.questionId))throw Error('该题号正在导入或更换绑定，请完成后再操作');
  bindingChanges.add(resolved.questionId);
  try{
    const old=(await bindings.all())[resolved.questionId];
    if(old)await bindings.bind(resolved.questionId,draftId,true);
    const row=await QFDB.get(draftId);if(!row||QFDB.isArchived(row))throw Error('请先选择未归档的有效记录');
    return await serial(async()=>{const {draftTargets:stored={}}=await chrome.storage.session.get('draftTargets'),draftTargets=cleanTargets(stored);draftTargets[draftId]=resolved.targetKey;await chrome.storage.session.set({draftTargets});return {draftTargets,draftId,targetKey:resolved.targetKey,bound:!!old,target:{id:resolved.targetKey,tabId:resolved.tabId,questionId:resolved.questionId,current:true,label:resolved.questionId}};});
  }finally{bindingChanges.delete(resolved.questionId);}
}
async function currentDraft(id){
  const draft=id?await QFDB.get(id):null;if(!draft)throw Error('请在填写台选择或新建记录后再导入。');if(QFRecordLibrary.repairRanking(draft))await QFDB.put(draft);return draft;
}
async function forgetRecord(draftId){
  if(typeof draftId!=='string'||!draftId)throw Error('无效记录');
  await bindings.forget(draftId);
  return serial(async()=>{
    const stored=await chrome.storage.session.get(['draftTargets','questionDraftBindings']);
    const draftTargets=cleanTargets(stored.draftTargets);delete draftTargets[draftId];
    const questionDraftBindings=Object.fromEntries(Object.entries(stored.questionDraftBindings||{}).filter(([,binding])=>binding.draftId!==draftId));
    await chrome.storage.session.set({draftTargets,questionDraftBindings});
    const local=await chrome.storage.local.get(['reportsByTarget','lastReport']);
    const reportsByTarget=Object.fromEntries(Object.entries(local.reportsByTarget||{}).filter(([,report])=>report.draftId!==draftId));
    const update={reportsByTarget};if(local.lastReport?.draftId===draftId)update.lastReport=null;
    await chrome.storage.local.set(update);return {draftTargets};
  });
}
async function imagePayload(file){
  const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
  const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(byte=>byte.toString(16).padStart(2,'0')).join('');
  return {name:file.name,type:file.type,lastModified:file.lastModified,sha256,base64:btoa(binary)};
}
async function panelVisible(windowId){
  const contexts=await chrome.runtime.getContexts({contextTypes:['SIDE_PANEL']});
  return contexts.some(c=>c.windowId===windowId&&c.documentUrl===chrome.runtime.getURL('app.html?panel=1'));
}
async function suppressOverlay(tabId,suppressed){
  await platformTab(tabId);
  await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},func:function(suppressed){
    globalThis.__qualityFillPanelOpen=suppressed;
    if(suppressed)document.getElementById('__quality_fill_widget_v1')?.remove();
  },args:[suppressed]});
}
async function panelOpened(windowId){
  if(!Number.isInteger(windowId))throw Error('未识别侧边栏窗口');
  const tabs=(await chrome.tabs.query({url:QFTabs.pattern,windowId})).filter(QFTabs.allowed);
  await Promise.allSettled(tabs.map(tab=>suppressOverlay(tab.id,true)));return {};
}
async function run(message,sender){
  let targetKey=message.targetKey;
  if(!targetKey){
    const tabId=message.tabId??sender?.tab?.id;if(!Number.isInteger(tabId))throw Error('请先在填写台选择题号');
    const scan=await probe(tabId,{action:'identity'});const questionId=message.questionId||scan.currentQuestionId;
    if(!questionId||!scan.consistent)throw Error('未识别出稳定的当前题号，请等待平台加载后刷新题号列表');
    targetKey=QFTabs.key(tabId,questionId);
  }
  // Resolve to an already-open question or a separate new tab before binding.
  // Never navigate an existing tab away from its current question.
  const resolved=await ensureQuestion(targetKey);targetKey=resolved.targetKey;
  const {tabId,questionId}=resolved;await platformTab(tabId);
  if(running.has(tabId)||runningQuestions.has(questionId)||bindingChanges.has(questionId))throw Error('该题号正在导入或更换绑定，请等本次完成后再操作。');running.add(tabId);runningQuestions.add(questionId);
  try{
    let binding=(await bindings.all())[questionId];
    const proposed=binding?.draftId||message.draftId;
    if(message.action!=='reset'&&proposed)binding=await bindings.bind(questionId,proposed);
    const draftId=binding?.draftId||message.draftId;
    if(!draftId)throw Error('当前题号尚未绑定记录，请在填写台选择记录和题号后导入');
    const draft=await currentDraft(draftId),fields=[];
    if(QFDB.isArchived(draft))throw Error('该题号对应记录已归档，请刷新题号');
    const overwriteMode=QFSchema.overwriteMode(draft);
    const includeImages=(await chrome.storage.local.get('includeImages')).includeImages!==false;
    for(const f of message.action==='reset'?[]:QFSchema.fields){
      if(f.type==='file'&&!includeImages)continue;
      let value=draft.values[f.id];
      if(f.type==='file')value=await Promise.all((draft.attachments?.[f.id]||[]).map(imagePayload));
      fields.push({...f,value});
    }
    let ranking=null;
    if(message.action!=='reset'&&draft.syncRanking){
      const groups=new Map();for(const [model]of QFSchema.models){const rank=Number(draft.ranks?.[model]||0);if(!Number.isInteger(rank)||rank<1||rank>5)throw Error('同步排序前，请为五个模型都选择名次。');if(!groups.has(rank))groups.set(rank,[]);groups.get(rank).push(model);}
      ranking=[...groups.entries()].sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    }
    // Resolve/verify the selected question after preparing large image payloads.
    await verifyQuestion(targetKey);
    if(QFDB.isArchived(await currentDraft(draftId)))throw Error('对应记录已归档，已停止导入，请刷新题号');
    if(binding)await bindings.verify(questionId,draftId,binding.revision);
    const payload={draftId:draft.id,fields,ranking,overwriteMode,overwrite:overwriteMode==='all',action:message.action||'fill',platformOnly:true,expectedQuestionId:questionId};
    let results;
    try{results=await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'MAIN',func:qualityFillEngine,args:[payload]});}
    catch(e){if(/too large|message length|maximum.*size|exceed.*size/i.test(e.message||''))throw Error('所选截图超过浏览器单次传输限制，请分批处理');throw Error('无法填写该题号，请确认平台页面仍已打开且加载完成，再刷新题号列表。');}
    if(results.some(r=>r.result?.stale))throw Error('填写过程中题号发生变化，已停止。请核对原题内容并重新选择题号。');
    const matched=results.filter(r=>r.result?.recognized);
    if(!matched.length)throw Error('该题号未找到匹配的填写区，请等待页面加载并展开填写区后再试。');
    if(matched.some(r=>r.result.busy))throw Error('网页上次填写仍在进行，请稍后再试。');
    const report={at:Date.now(),draftId:draft.id,draftName:draft.name,tabId,targetKey,questionId,tabTitle:'题号 '+questionId,includeImages,overwriteMode,reset:message.action==='reset',items:matched.flatMap(r=>r.result.items||[])};
    const counts={filled:0,same:0,done:0,occupied:0,pending:0,error:0,upload:0};for(const item of report.items)counts[item.status]=(counts[item.status]||0)+1;report.counts=counts;
    await serial(async()=>{
      if(!await QFDB.get(draft.id))throw Error('这条记录已删除，请在平台核对本次已填写的内容');
      const stored=await chrome.storage.session.get(['questionDraftBindings','draftTargets']);
      const questionDraftBindings=stored.questionDraftBindings||{},draftTargets=cleanTargets(stored.draftTargets);
      if(message.action!=='reset')questionDraftBindings[targetKey]={draftId:draft.id};draftTargets[draft.id]=targetKey;
      await chrome.storage.session.set({questionDraftBindings,draftTargets});
      const {reportsByTarget={}}=await chrome.storage.local.get('reportsByTarget');reportsByTarget[draft.id+':'+targetKey]=report;
      await chrome.storage.local.set({lastReport:report,reportsByTarget});
    });
    try{
      const tab=await platformTab(tabId),suppressed=await panelVisible(tab.windowId);
      await suppressOverlay(tabId,suppressed);
      if(!suppressed){await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},files:['overlay.js']});await chrome.tabs.sendMessage(tabId,{type:'qf-report',report});}
    }catch{}
    return report;
  }finally{running.delete(tabId);runningQuestions.delete(questionId);}
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message?.type?.startsWith('qf-'))return;
  (async()=>{
    if(message.type==='qf-fill')return run(message,sender);
    if(message.type==='qf-tabs')return questionTargets(!!message.force);
    if(message.type==='qf-select-target')return selectTarget(message.draftId,message.targetKey||null,message.editorId);
    if(message.type==='qf-set-target')return (await selectTarget(message.draftId,message.targetKey||null,message.editorId)).draftTargets;
    if(message.type==='qf-bind-record')return manualBind(message.draftId,message.targetKey);
    if(message.type==='qf-platform-changed'){
      if(!Number.isInteger(sender?.tab?.id))throw Error('无效的平台通知');const tab=await platformTab(sender.tab.id);
      const scan=message.scan;if(!scan?.allowed||scan.href!==tab.url||!Array.isArray(scan.questions)||!Array.isArray(scan.retiredQuestionIds))return {};
      scanCache.set(tab.id,{signature:tab.url+'|'+tab.title,at:Date.now(),value:{tab,scan}});await archiveCompleted([{tab,scan}]);await publishPlatformSelection(tab,scan);await changed();chrome.tabs.sendMessage(tab.id,{type:'qf-context-changed'}).catch(()=>{});return {};
    }
    if(message.type==='qf-forget-record')return forgetRecord(message.draftId);
    if(message.type==='qf-panel-visible')return panelOpened(message.windowId);
    if(message.type==='qf-tab-context'){
      const tabId=message.tabId??sender?.tab?.id;if(!Number.isInteger(tabId))return {allowed:false};
      const tab=await chrome.tabs.get(tabId);if(!QFTabs.allowed(tab))return {allowed:false};
      const scan=await probe(tab.id,{action:'identity'});if(!scan.currentQuestionId||!scan.consistent)return {allowed:true,questionId:null};
      const targetKey=QFTabs.key(tab.id,scan.currentQuestionId);
      const {activeDraftId}=await chrome.storage.local.get('activeDraftId'),binding=(await bindings.all())[scan.currentQuestionId];
      const row=await QFDB.get(binding?.draftId||activeDraftId);if(scan.currentUnavailable||binding&&(!row||QFDB.isArchived(row)))return {allowed:true,questionId:null};
      return {allowed:true,questionId:scan.currentQuestionId,targetKey,draftId:binding?.draftId||activeDraftId,draftName:row?.name||'',overwriteMode:QFSchema.overwriteMode(row),bound:!!binding};
    }
    if(message.type==='qf-editor'){
      const url=chrome.runtime.getURL('app.html');
      const existing=(await chrome.runtime.getContexts({contextTypes:['TAB'],documentUrls:[url]})).find(c=>c.tabId>=0);
      if(existing){await chrome.tabs.update(existing.tabId,{active:true});await chrome.windows.update(existing.windowId,{focused:true});}else await chrome.tabs.create({url});return {};
    }
    if(message.type==='qf-sidepanel'){await chrome.sidePanel.open({tabId:sender.tab.id});return {};}
    throw Error('未知操作');
  })().then(result=>respond({ok:true,result})).catch(error=>respond({ok:false,error:error.message||String(error)}));return true;
});
chrome.tabs.onRemoved?.addListener(tabId=>{scanCache.delete(tabId);changed().catch(()=>{});});
chrome.tabs.onUpdated?.addListener((_id,info)=>{if(info.status==='complete'||info.url)changed().catch(()=>{});});
async function publishPlatformSelection(tab,scan){
  if(!tab.active||!scan.consistent||scan.currentUnavailable||!QFBindings.validQuestion(scan.currentQuestionId))return;
  return serial(async()=>{
    const {platformSelections={}}=await chrome.storage.session.get('platformSelections'),old=platformSelections[tab.windowId];
    if(old?.tabId===tab.id&&old.questionId===scan.currentQuestionId)return;
    const selection={tabId:tab.id,windowId:tab.windowId,questionId:scan.currentQuestionId,at:Date.now()};platformSelections[tab.windowId]=selection;
    await chrome.storage.session.set({platformSelections,platformSelection:selection});
  });
}
chrome.tabs.onActivated?.addListener(info=>{(async()=>{const tab=await chrome.tabs.get(info.tabId);if(QFTabs.allowed(tab))await publishPlatformSelection(tab,await probe(tab.id,{action:'identity'}));await changed();})().catch(()=>{});});
globalThis.addEventListener?.('qf-archive-changed',()=>{changed().catch(()=>{});chrome.tabs.query({url:QFTabs.pattern}).then(tabs=>Promise.allSettled(tabs.filter(QFTabs.allowed).map(tab=>chrome.tabs.sendMessage(tab.id,{type:'qf-context-changed'})))).catch(()=>{});});
