'use strict';
const $=id=>document.getElementById(id);
const extension=location.protocol==='chrome-extension:' && !!globalThis.chrome?.runtime?.id;
if(new URLSearchParams(location.search).has('panel'))document.body.classList.add('compact');
const settings={
  async get(keys){if(extension)return chrome.storage.local.get(keys);return Object.fromEntries(keys.map(k=>[k,JSON.parse(localStorage.getItem('qf_'+k)||'null')]));},
  async set(values){if(extension)return chrome.storage.local.set(values);for(const [k,v]of Object.entries(values))localStorage.setItem('qf_'+k,JSON.stringify(v));}
};
let draft,saveTimer,saveQueue=Promise.resolve(),imagePreferenceQueue=Promise.resolve(),includeImages=true,toastTimer,tabs=[],records=[],targetAssignments={},busy=false,switching=false,renamingId=null,locating=false,targetOperation=0,targetRevision=0,refreshOperation=0,reportOperation=0,recordSwitchJob=null,pendingRecord=null;
let recordFilter='active',archiveRefreshPending=false,selectedTargetKey='',targetBindings={},targetSyncPending=false,editorWindowId=null;
const editorId=crypto.randomUUID();
const draftStates=new WeakMap();
function adoptDraft(row,saved=true){if(QFRecordLibrary.repairRanking(row))saved=false;if(draft?.id!==row.id)selectedTargetKey='';draft=row;draft.overwriteMode=QFSchema.overwriteMode(row);draft.overwrite=draft.overwriteMode==='all';draft.archived=QFDB.isArchived(draft);recordFilter=draft.archived?'archived':'active';draft.attachments||={};draft.ranks||={};draftStates.set(draft,{revision:0,saved:saved?0:-1,pending:null,pendingRevision:-1});}
function draftState(row=draft){if(!draftStates.has(row))draftStates.set(row,{revision:0,saved:-1,pending:null,pendingRevision:-1});return draftStates.get(row);}
function markDraftDirty(){draftState().revision++;}
function cancelTargetSelection(){targetOperation++;locating=false;}
function syncImageOptions(){
  for(const id of ['includeImages','quickIncludeImages']){const input=$(id);input.checked=includeImages;input.disabled=busy||switching;}
}
function setIncludeImages(checked){
  includeImages=checked;syncImageOptions();
  imagePreferenceQueue=imagePreferenceQueue.catch(()=>{}).then(()=>settings.set({includeImages:checked}));
  imagePreferenceQueue.catch(e=>toast('图片导入选项保存失败：'+e.message));
}
function syncQuickState(){
  $('formSections').inert=switching;
  const main=$('targetTab'),quick=$('quickTarget');quick.value=main.value;
  quick.title=main.selectedOptions[0]?.textContent||'选择题号';
  main.disabled=busy||switching;quick.disabled=busy||switching||!extension;
  for(const id of ['fillBtn','focusTarget','resetHistory','overwriteMode'])$(id).disabled=busy||switching||locating;
  $('quickFill').disabled=busy||switching||locating||!extension||!draft;
  $('quickFill').textContent=busy?'导入中…':locating?'定位中…':switching?'切换中…':'导入';
  $('quickFill').title=draft?'将“'+draft.name+'”导入 '+quick.title:'将当前记录导入所选题号';
  $('toggleRecords').setAttribute('aria-expanded',String(document.body.classList.contains('records-open')));
  for(const id of ['draftSelect','draftName','newDraft','importDraft','exportDraft','archiveDraft','deleteDraft'])$(id).disabled=busy||switching;
  for(const button of document.querySelectorAll('[data-switch-record],[data-rename-record],[data-delete-record],[data-archive-record],[data-record-filter]'))button.disabled=busy||switching;
  syncImageOptions();
  if(draft){$('archiveDraft').textContent=draft.archived?'恢复':'归档';$('draftArchiveBadge').hidden=!draft.archived;}
  if(archiveRefreshPending&&draft&&!busy&&!switching&&!recordSwitchJob)queueMicrotask(()=>{if(archiveRefreshPending&&!busy&&!switching&&!recordSwitchJob)refreshArchiveRecords().catch(e=>toast('归档状态刷新失败：'+e.message));});
  if(pendingPlatformSelection&&!busy&&!switching&&!locating&&!recordSwitchJob)queueMicrotask(()=>{if(pendingPlatformSelection&&!busy&&!switching&&!locating&&!recordSwitchJob){const selection=pendingPlatformSelection;pendingPlatformSelection=null;followPlatform(selection).catch(error=>toast(error.message));}});
  if(targetSyncPending&&!busy&&!switching&&!locating&&!recordSwitchJob)queueMicrotask(()=>{if(targetSyncPending&&!busy&&!switching&&!locating&&!recordSwitchJob){targetSyncPending=false;if(selectedTargetKey)selectTarget(selectedTargetKey).catch(e=>toast(e.message));}});
  if(pendingRecord&&!busy&&!switching&&!recordSwitchJob)queueMicrotask(()=>{if(pendingRecord&&!busy&&!switching&&!recordSwitchJob){const next=pendingRecord;pendingRecord=null;selectDraft(next.id,next.external).catch(e=>toast(e.message));}});
}
function syncQuickOptions(){
  $('quickTarget').replaceChildren(...Array.from($('targetTab').options,o=>o.cloneNode(true)));syncQuickState();
}
const urls=new Set();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={filled:'已写入',same:'内容一致',done:'已填跳过',pending:'待解锁',occupied:'已有内容',error:'未成功',upload:'已交上传'};
function toast(message){$('toast').textContent=message;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',6500);}
function blank(){return {id:crypto.randomUUID(),name:'未命名记录',archived:false,values:{},attachments:{},ranks:{},syncRanking:false,overwrite:false,overwriteMode:'none',createdAt:Date.now(),updatedAt:Date.now()};}
function usedCount(withImages=true){return QFSchema.fields.filter(f=>f.type==='file'?withImages&&(draft.attachments[f.id]||[]).length:String(draft.values[f.id]||'').trim()).length+(draft.syncRanking?1:0);}
function updateStats(){
  $('usedCount').textContent=usedCount();
  for(const f of QFSchema.fields){
    const count=document.querySelector(`[data-count-for="${f.id}"]`);const value=draft.values[f.id]||'';
    if(count)count.textContent=String(value).length+(f.max?' / '+f.max:'')+' 字符';
    const ready=document.querySelector(`[data-ready-for="${f.id}"]`);const has=f.type==='file'?(draft.attachments[f.id]||[]).length:!!String(value).trim();
    if(ready){ready.textContent=has?'已准备':'待填写';ready.classList.toggle('ready',!!has);}
  }
}
function refreshRecordOptions(){
  records.sort((a,b)=>(a.createdAt||a.updatedAt)-(b.createdAt||b.updatedAt)||a.id.localeCompare(b.id));
  const groups=[false,true].map(archived=>{const group=document.createElement('optgroup');group.label=archived?'已归档':'未归档';for(const row of records.filter(row=>QFDB.isArchived(row)===archived)){const option=document.createElement('option');option.value=row.id;option.textContent=row.name||'未命名记录';group.append(option);}return group;});
  $('draftSelect').replaceChildren(...groups.filter(group=>group.children.length));$('draftSelect').value=draft.id;
}
function updateCurrentRecordCard(){
  const button=document.querySelector('[data-switch-record="'+CSS.escape(draft.id)+'"]');
  if(button){button.querySelector('.record-title').textContent=draft.name||'未命名记录';button.closest('.record-item').querySelector('.record-meta>span').textContent=QFDB.summary(draft).fieldCount+' 个字段';}
}
function upsertSummary(row){
  const item=QFDB.summary(row),index=records.findIndex(r=>r.id===row.id);
  if(index<0){records.push(item);refreshRecordOptions();renderRecordList();}
  else{records[index]=item;const option=Array.from($('draftSelect').options).find(o=>o.value===row.id);if(option)option.textContent=item.name;updateCurrentRecordCard();}
}
function scheduleSave(){markDraftDirty();QFShared.remember(draft).catch(e=>toast('未保存修改暂存失败：'+e.message));clearTimeout(saveTimer);$('saveState').textContent='正在保存…';saveTimer=setTimeout(()=>saveNow().catch(e=>toast('保存失败：'+e.message)),180);updateStats();updateCurrentRecordCard();updatePairing();}
async function saveNow(){
  clearTimeout(saveTimer);if(!draft)return;
  const row=draft,state=draftState(row);
  if(state.saved>=state.revision)return;
  if(state.pending){await state.pending;if(row===draft&&state.saved<state.revision)return saveNow();return;}
  const revision=state.revision;
  row.updatedAt=Date.now();row.createdAt||=row.updatedAt;const snapshot=structuredClone(row);
  const operation=saveQueue.catch(()=>{}).then(async()=>{
    try{
      const result=await QFDB.put(snapshot);
      if(result?.row){
        let saved,version;
        do{version=state.revision;saved=await QFSharedMap.rebase(structuredClone(row),snapshot,structuredClone(result.row));}while(version!==state.revision);
        Object.assign(row,saved);
      }
      state.saved=Math.max(state.saved,revision);upsertSummary(row===draft?row:snapshot);
      if(row===draft)$('saveState').textContent=state.saved>=state.revision?'已在本机保存':'正在保存…';
    }catch(e){globalThis.QFSharedUI?.failed(e);if(draft===row)$('saveState').textContent=e.code==='QF_RECORD_DELETED'?'记录已删除，请切换记录或刷新':'保存失败，修改已保留';throw e;}
  });
  const pending=operation.finally(()=>{if(state.pending===pending)state.pending=null;});
  saveQueue=pending;state.pending=pending;state.pendingRevision=revision;
  return pending;
}
async function draftList(){records=await QFDB.summaries();refreshRecordOptions();renderRecordList();}
function recordTarget(id){const key=targetAssignments[id];return tabs.find(t=>t.id===key)?.label||(key?key.split(':')[1]+'（未加载）':'未选择题号');}
function renderRecordList(){
  if(!draft)return;
  const list=records.map(r=>r.id===draft.id?draft:r);
  const index=list.findIndex(r=>r.id===draft.id),number=index<0?'—':String(index+1).padStart(2,'0');
  $('recordCount').textContent='共 '+list.length+' 条';
  $('currentRecordNumber').textContent=number;
  const label='当前记录 '+number+'：'+draft.name+'；共 '+list.length+' 条，点击切换记录';
  $('toggleRecords').title=label;$('toggleRecords').setAttribute('aria-label',label);
  const archivedCount=list.filter(row=>QFDB.isArchived(row)).length;
  $('activeRecordCount').textContent=list.length-archivedCount;$('archivedRecordCount').textContent=archivedCount;
  for(const button of document.querySelectorAll('[data-record-filter]'))button.setAttribute('aria-pressed',String(button.dataset.recordFilter===recordFilter));
  const indexes=new Map(list.map((row,index)=>[row.id,index]));
  const visible=list.filter(row=>QFDB.isArchived(row)===(recordFilter==='archived'));
  $('recordList').innerHTML=visible.map(r=>{
    const i=indexes.get(r.id),archived=QFDB.isArchived(r),count=r.id===draft.id?QFDB.summary(draft).fieldCount:r.fieldCount||0;
    return `<article class="record-item ${r.id===draft.id?'selected':''}"><button class="record-select" data-switch-record="${escape(r.id)}" ${busy||switching?'disabled':''}><span class="record-index">${String(i+1).padStart(2,'0')}</span><span class="record-title">${escape(r.name||'未命名记录')}</span>${r.id===draft.id?'<span class="record-current">当前</span>':''}</button><div class="record-meta"><span>${count} 个字段</span><div class="record-actions"><button data-archive-record="${escape(r.id)}" data-archive-to="${!archived}" ${busy||switching?'disabled':''}>${archived?'恢复':'归档'}</button><button data-rename-record="${escape(r.id)}" ${busy||switching?'disabled':''}>重命名</button><button class="record-delete" data-delete-record="${escape(r.id)}" title="删除这条记录及本机截图" ${busy||switching?'disabled':''}>删除</button></div></div><div class="record-target" title="${escape(recordTarget(r.id))}">↗ ${escape(recordTarget(r.id))}</div></article>`;
  }).join('')||'<p class="record-empty">'+(recordFilter==='archived'?'暂无已归档记录':'暂无未归档记录，可新建记录或到已归档中恢复。')+'</p>';
}
function updatePairing(){if(draft){$('pairing').textContent='当前导入：'+draft.name+' → '+(tabs.find(tab=>tab.id===selectedTargetKey)?.label||'未选择题号');const questionId=selectedTargetKey.split(':')[1];$('bindingNotice').textContent=questionId?(targetBindings[questionId]?'本题已固定绑定当前记录；手动切换记录可更换绑定。':'本题尚未绑定；首次导入后固定当前记录。'):'选择题号后会自动载入该题号绑定的记录。';}syncQuickState();}
async function loadReport(){
  const operation=++reportOperation,id=draft?.id,targetKey=$('targetTab').value;
  const {reportsByTarget={},lastReport}=await settings.get(['reportsByTarget','lastReport']);
  if(operation!==reportOperation||draft?.id!==id||$('targetTab').value!==targetKey)return;
  renderReport(reportsByTarget?.[id+':'+targetKey]||(lastReport?.draftId===id&&lastReport.targetKey===targetKey?lastReport:null));
}
function selectDraft(id,external=false){
  if(!id)return Promise.resolve();pendingRecord={id,external,targetKey:external?null:selectedTargetKey};
  if(recordSwitchJob||busy||switching)return recordSwitchJob||Promise.resolve();
  switching=true;cancelTargetSelection();syncQuickState();
  recordSwitchJob=Promise.resolve().then(async()=>{
    try{
      while(pendingRecord){
        const nextRequest=pendingRecord;pendingRecord=null;
        if(nextRequest.id===draft.id){recordFilter=draft.archived?'archived':'active';renderRecordList();document.body.classList.remove('records-open');continue;}
        try{await saveNow();}catch(e){if(e.code!=='QF_RECORD_DELETED')throw e;}
        if(pendingRecord)continue;
        if(nextRequest.external&&(await settings.get(['activeDraftId'])).activeDraftId!==nextRequest.id)continue;
        const next=await QFDB.get(nextRequest.id);if(!next)throw Error('该记录已删除，请刷新记录列表。');
        if(pendingRecord)continue;
        let target=null;
        if(extension&&!nextRequest.external&&nextRequest.targetKey&&!QFDB.isArchived(next)){const result=await chrome.runtime.sendMessage({type:'qf-bind-record',draftId:next.id,targetKey:nextRequest.targetKey});if(!result.ok)throw Error(result.error);target=result.result;}
        if(pendingRecord)continue;
        adoptDraft(next);if(target)acceptTarget(target);upsertSummary(next);if(!nextRequest.external)await settings.set({activeDraftId:next.id});
        render();applyTargetSelection();loadReport().catch(e=>toast(e.message));document.body.classList.remove('records-open');
      }
    }finally{switching=false;recordSwitchJob=null;$('draftSelect').value=draft.id;renderRecordList();syncQuickState();}
  });return recordSwitchJob;
}
function fieldHTML(f){
  const id='f-'+f.id;
  let input='';
  if(f.type==='text')input=`<textarea id="${id}" data-field="${f.id}" rows="${f.rows||4}" ${f.max?'maxlength="'+f.max+'"':''} placeholder="${escape(f.placeholder||'请填写'+f.label)}"></textarea><div class="count" data-count-for="${f.id}"></div>`;
  if(f.type==='input')input=`<input id="${id}" data-field="${f.id}" ${f.max?'maxlength="'+f.max+'"':''} placeholder="请输入模型的实际名称"><div class="count" data-count-for="${f.id}"></div>`;
  if(f.type==='select')input=f.free?`<input id="${id}" data-field="${f.id}" list="${id}-options" placeholder="输入原网页中的准确领域名称"><datalist id="${id}-options">${f.options.map(v=>`<option value="${escape(v)}">`).join('')}</datalist><div class="small-hint">输入原网页下拉框中的完整选项文字，以下拉框实际选项为准。</div>`:`<select id="${id}" data-field="${f.id}"><option value="">暂不填写</option>${f.options.map(v=>`<option value="${escape(v)}">${escape(v)}</option>`).join('')}</select>`;
  if(f.type==='radio')input=`<div class="radio-group" id="${id}">${[['','暂不填写'],...f.options].map(([v,l])=>`<label class="radio-option"><input type="radio" name="${f.id}" data-field="${f.id}" value="${v}">${escape(l)}</label>`).join('')}</div>`;
  if(f.type==='file')input=`<div class="upload-area" tabindex="0" role="group" aria-label="截图粘贴区，点击后按 Ctrl+V 或 Win+V" data-drop="${f.id}"><div class="upload-symbol">↑</div><p>点击这里，按 Ctrl+V 粘贴截图</p><small>也可按 Win+V 选择剪贴板图片，或拖拽 / 选择文件<br>支持多张图片 · 每张不超过 20MB · 保存在本机</small><br><button data-choose="${f.id}">选择截图</button><input type="file" id="${id}" data-upload="${f.id}" accept="image/*" multiple hidden></div><div class="file-list" id="files-${f.id}"></div>`;
  return `<div class="field"><div class="field-head"><label ${f.type==='radio'?'':'for="'+id+'"'}>${escape(f.label)}</label><span class="field-tags">${f.conditional?'<span class="tag condition">条件出现</span>':''}<span class="tag" data-ready-for="${f.id}">待填写</span></span></div>${input}</div>`;
}
function section(id,num,title,description,body){return `<section class="form-card" id="section-${id}"><div class="card-header"><span class="section-number">${num}</span><div><h2>${title}</h2><p>${description}</p></div><button class="collapse" data-collapse="${id}">收起 ⌃</button></div><div class="card-body" id="body-${id}">${body}</div></section>`;}
function render(){
  QFImageViewer.close();
  $('draftSelect').value=draft.id;
  for(const url of urls)URL.revokeObjectURL(url);urls.clear();
  const bySection=id=>QFSchema.fields.filter(f=>f.section===id).map(fieldHTML).join('');
  const author=QFSchema.fields.filter(f=>f.section==='author');
  let html=section('author','01','出题内容','题目、出题说明与两类核心考点',`<div class="two-cols">${author.slice(0,2).map(fieldHTML).join('')}</div>${author.slice(2).map(fieldHTML).join('')}`);
  for(const [index,[key,name]]of QFSchema.models.entries()){
    if(key==='arena1')html+=`<div class="gate-note"><div class="gate-symbol">↗</div><div><h3>剩余字段解锁后，继续补填</h3><p>请在原网页完成需要的审核与确认。剩余模型和排序区域出现后，再点“一键补填”。</p></div></div>`;
    html+=section(key,String(index+2).padStart(2,'0'),escape(name),'回复内容、达成性判断、备注与截图',bySection(key));
  }
  const ranks=QFSchema.models.map(([key,name])=>`<div class="rank-item"><label for="rank-${key}">${escape(name)}</label><select id="rank-${key}" data-rank="${key}"><option value="">未选择</option>${[1,2,3,4,5].map(i=>`<option value="${i}">第 ${i} 名</option>`).join('')}</select></div>`).join('');
  html+=section('ranking','07','决定性+非决定性核心考点的达成性排序','相同名次表示并列',`<label class="check"><input type="checkbox" id="syncRanking">补填时同时同步五个模型的名次</label><div class="rank-options">${ranks}</div><p class="rank-description">勾选后会尝试通过网页的拖动事件调整排序，并核对结果；若网页不支持，会提示你手动调整。未勾选时只填写排序说明。此选项只影响网页导入，不改变存题软件的二轮资料开关。</p>${bySection('ranking')}`);
  $('formSections').innerHTML=html;
  $('draftName').value=draft.name;$('overwriteMode').value=QFSchema.overwriteMode(draft);$('syncRanking').checked=!!draft.syncRanking;
  for(const el of document.querySelectorAll('[data-field]')){const value=draft.values[el.dataset.field]||'';if(el.type==='radio')el.checked=el.value===value;else el.value=value;}
  for(const el of document.querySelectorAll('[data-rank]'))el.value=draft.ranks?.[el.dataset.rank]||'';
  for(const f of QFSchema.fields.filter(x=>x.type==='file'))renderFiles(f.id);
  const links=[['author','出题内容'],['doubao','豆包 turbo 2.1'],['gpt56','GPT-5.6-sol'],['claude','Claude opus 4.6'],['arena1','随机模型 1'],['arena2','随机模型 2'],['ranking','达成性排序']];
  $('navigation').innerHTML=links.map(([key,title],i)=>`<a href="#section-${key}" ${i===0?'class="active"':''}><span class="nav-index">${String(i+1).padStart(2,'0')}</span>${title}</a>`).join('');
  updateStats();updatePairing();renderRecordList();renderLibrarySource();
}
function renderLibrarySource(){
  const source=draft.recordLibrary,box=$('librarySourceInfo'),body=$('librarySourceBody');
  box.hidden=!source;body.replaceChildren();if(!source)return;
  const line=text=>{const p=document.createElement('p');p.textContent=text;body.append(p);};
  line('来源编号：'+String(source.recordId||'')+' · '+(source.archived?'已归档':'未归档'));
  line('标签：'+String(source.tags||'未填写')+' · 验收结果：'+String(source.acceptanceResult||'未填写'));
  const names=QFSchema.models.map(([key],index)=>'模型'+(index+1)+'：'+String(source.modelNames?.[key]||'未填写'));
  line('按模型顺序对应网页的五个回复栏。'+names.join('；')+'。请核对实际模型与平台要求。');
  if(source.rankingText)line('原始排序：'+String(source.rankingText));
  if((source.attachments?.length)||source.legacy)line('题目附件和旧版历史资料已随来源信息保留在本机及助手备份中，不发送至网页字段。');
  for(const warning of Array.isArray(source.warnings)?source.warnings:[])line('提醒：'+String(warning));
}
function renderFiles(id){
  const list=$('files-'+id);list.replaceChildren();
  for(const [i,file]of (draft.attachments[id]||[]).entries()){
    const row=document.createElement('div');row.className='file-item';
    const img=document.createElement('img'),url=URL.createObjectURL(file);urls.add(url);img.loading='lazy';img.decoding='async';img.src=url;img.alt='截图预览';img.onload=img.onerror=()=>{URL.revokeObjectURL(url);urls.delete(url);};
    const title=document.createElement('span');title.textContent=file.name;
    const preview=document.createElement('button');preview.type='button';preview.className='image-preview-button';preview.title='点击查看大图：'+file.name;preview.setAttribute('aria-label','查看原图：'+file.name);
    preview.append(img,title);preview.onclick=()=>QFImageViewer.open({files:draft.attachments[id],index:i,title:draft.name+' · '+(QFSchema.models.find(([key])=>key===QFSchema.fields.find(f=>f.id===id)?.section)?.[1]||'回复截图')});
    const size=document.createElement('small');size.textContent=(file.size/1024/1024).toFixed(2)+' MB';
    const del=document.createElement('button');del.textContent='×';del.title='移除此截图';del.onclick=()=>{draft.attachments[id].splice(i,1);renderFiles(id);scheduleSave();};
    row.append(preview,size,del);list.append(row);
  }
}
async function addFiles(id,files){
  const accepted=[];
  for(const file of files){
    if(!file.type.startsWith('image/')){toast(file.name+' 不是图片，已跳过');continue;}
    if(file.size>20*1024*1024){toast(file.name+' 超过 20MB，已跳过');continue;}
    if([...(draft.attachments[id]||[]),...accepted].some(x=>x.name===file.name&&x.size===file.size&&x.lastModified===file.lastModified))continue;
    accepted.push(file);
  }
  draft.attachments[id]=[...(draft.attachments[id]||[]),...accepted];if(accepted.length)markDraftDirty();renderFiles(id);updateStats();await saveNow();return accepted.length;
}
document.addEventListener('input',event=>{
  const el=event.target;
  if(el.dataset.field){draft.values[el.dataset.field]=el.value;scheduleSave();}
  if(el.dataset.rank){draft.ranks[el.dataset.rank]=el.value;scheduleSave();}
  if(el.id==='draftName'){draft.name=el.value||'未命名记录';scheduleSave();const o=$('draftSelect').selectedOptions[0];if(o)o.textContent=draft.name;}
  if(el.id==='overwriteMode'){draft.overwriteMode=el.value;draft.overwrite=el.value==='all';scheduleSave();}
  if(el.id==='syncRanking'){draft.syncRanking=el.checked;scheduleSave();}
  if(el.id==='includeImages'||el.id==='quickIncludeImages')setIncludeImages(el.checked);
});
document.addEventListener('change',event=>{if(event.target.dataset.upload){addFiles(event.target.dataset.upload,[...event.target.files]).catch(e=>toast(e.message));event.target.value='';}});
document.addEventListener('click',event=>{
  const pasteArea=event.target.closest('[data-drop]');if(pasteArea&&!event.target.closest('button,input'))pasteArea.focus();
  const choose=event.target.closest('[data-choose]');if(choose)$('f-'+choose.dataset.choose).click();
  const collapse=event.target.closest('[data-collapse]');if(collapse){const body=$('body-'+collapse.dataset.collapse);body.classList.toggle('hidden');collapse.textContent=body.classList.contains('hidden')?'展开 ⌄':'收起 ⌃';}
  const nav=event.target.closest('#navigation a');if(nav){document.querySelectorAll('#navigation a').forEach(x=>x.classList.remove('active'));nav.classList.add('active');}
});
document.addEventListener('paste',event=>{
  const area=event.target.closest?.('[data-drop]');if(!area)return;
  const images=Array.from(event.clipboardData?.items||[]).filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
  if(!images.length)images.push(...Array.from(event.clipboardData?.files||[]).filter(f=>f.type.startsWith('image/')));
  event.preventDefault();
  if(!images.length){toast('剪贴板中没有图片。请先复制截图，再在此处粘贴。');return;}
  const files=images.map(file=>new File([file],file.name&&file.name!=='image.png'?file.name:'截图-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomUUID().slice(0,4)+'.'+(file.type==='image/jpeg'?'jpg':file.type==='image/webp'?'webp':'png'),{type:file.type,lastModified:Date.now()}));
  addFiles(area.dataset.drop,files).then(count=>toast(count?'已粘贴 '+count+' 张图片并保存在当前记录。':'未添加新图片，请检查大小、类型或是否已存在。')).catch(e=>toast(e.message));
});
document.addEventListener('dragover',event=>{const area=event.target.closest('[data-drop]');if(area){event.preventDefault();area.classList.add('dragover');}});
document.addEventListener('dragleave',event=>event.target.closest('[data-drop]')?.classList.remove('dragover'));
document.addEventListener('drop',event=>{const area=event.target.closest('[data-drop]');if(area){event.preventDefault();area.classList.remove('dragover');addFiles(area.dataset.drop,[...event.dataTransfer.files]).catch(e=>toast(e.message));}});
function acceptTarget(result){
  targetAssignments=result.draftTargets||{};selectedTargetKey=result.targetKey||'';
  if(result.target&&!tabs.some(tab=>tab.id===result.target.id))tabs.push(result.target);
  if(result.bound&&result.target)targetBindings[result.target.questionId]=result.draftId;
}
function applyTargetSelection(){
  const main=$('targetTab'),previous=main.value;
  if(draft.archived)selectedTargetKey='';
  if(extension){const empty=document.createElement('option');empty.value='';empty.textContent=tabs.length?'选择完整题号':'当前没有可导入题号，请打开平台或刷新题号';main.replaceChildren(empty,...tabs.map(tab=>{const option=document.createElement('option');option.value=tab.id;option.textContent=tab.label;return option;}));}
  if(!selectedTargetKey&&!draft.archived){const assigned=targetAssignments[draft.id];if(tabs.some(tab=>tab.id===assigned))selectedTargetKey=assigned;}
  main.value=locating&&tabs.some(tab=>tab.id===previous)?previous:selectedTargetKey;
  syncQuickOptions();renderRecordList();updatePairing();
}
async function refreshTabs(force=false){
  if(!extension){$('targetTab').innerHTML='<option value="">需安装扩展后选择平台题号</option>';$('fillBtn').textContent='需安装扩展后使用补填';syncQuickOptions();updatePairing();renderRecordList();return;}
  const operation=++refreshOperation,revision=targetRevision;
  const response=await chrome.runtime.sendMessage({type:'qf-tabs',force});if(!response.ok)throw Error(response.error);
  if(operation!==refreshOperation)return;
  tabs=response.result.tabs;targetBindings=response.result.questionBindings||{};if(revision===targetRevision)targetAssignments=response.result.draftTargets||{};
  if(selectedTargetKey&&!tabs.some(tab=>tab.id===selectedTargetKey)){
    const moved=tabs.find(tab=>tab.questionId===selectedTargetKey.split(':')[1]);
    selectedTargetKey=moved?.id||'';
  }
  applyTargetSelection();
  const bound=targetBindings[selectedTargetKey.split(':')[1]];
  if(bound&&bound!==draft.id){if(busy||switching||locating)targetSyncPending=true;else await selectTarget(selectedTargetKey);}
}
async function selectTarget(targetKey,focus=false){
  if(busy||switching){targetSyncPending=true;return;}
  const operation=++targetOperation;locating=true;$('targetTab').value=targetKey||'';syncQuickState();
  try{
    await saveNow();
    const response=await chrome.runtime.sendMessage({type:'qf-select-target',draftId:draft.id,targetKey,editorId});if(!response.ok)throw Error(response.error);
    if(operation!==targetOperation||response.result.stale)return;
    const result=response.result;
    if(result.draftId!==draft.id){const next=await QFDB.get(result.draftId);if(operation!==targetOperation)return;if(!next)throw Error('绑定记录已删除');adoptDraft(next);await settings.set({activeDraftId:next.id});render();}
    if(operation!==targetOperation)return;
    acceptTarget(result);targetRevision++;locating=false;applyTargetSelection();loadReport().catch(error=>toast(error.message));
    if(focus&&result.target){const tab=await chrome.tabs.get(result.target.tabId);if(operation!==targetOperation)return;await chrome.tabs.update(tab.id,{active:true});await chrome.windows.update(tab.windowId,{focused:true});}
  }catch(error){if(operation===targetOperation){locating=false;selectedTargetKey='';applyTargetSelection();toast(error.message);}}
  finally{if(operation===targetOperation){locating=false;syncQuickState();}}
}
async function followPlatform(selection){
  if(!selection||selection.windowId!==editorWindowId)return;
  const key=tabs.find(tab=>tab.questionId===selection.questionId&&tab.tabId===selection.tabId)?.id||tabs.find(tab=>tab.questionId===selection.questionId)?.id;
  if(!key||key===selectedTargetKey)return;
  if(busy||switching||locating){pendingPlatformSelection=selection;return;}
  await selectTarget(key);
}
let pendingPlatformSelection=null;
$('targetTab').onchange=()=>selectTarget($('targetTab').value||null);
$('quickTarget').onchange=()=>selectTarget($('quickTarget').value||null);
$('refreshTabs').onclick=()=>refreshTabs(true).catch(e=>toast(e.message));
$('focusTarget').onclick=()=>{if(!extension){toast('请安装扩展后选择平台题号。');return;}const key=$('targetTab').value;if(!key){toast('请先选择题号');return;}selectTarget(key,true);};
function renderReport(report){
  if(!report){$('writtenCount').textContent='—';$('pendingCount').textContent='—';$('reportSummary').textContent='补填记录 · 当前记录与题号尚未执行';$('reportBody').innerHTML='<p class="empty">选择题号并补填后，这里显示当前记录的字段结果。</p>';return;}
  const c=report.counts;
  $('writtenCount').textContent=c.filled;$('pendingCount').textContent=c.pending;
  $('reportSummary').textContent=report.reset?'本题补填记录已清除':`补填记录 · ${new Date(report.at).toLocaleTimeString('zh-CN',{hour12:false})} · 写入 ${c.filled} / 已完成 ${c.done+c.same} / 待填 ${c.pending} / 失败 ${c.error}`;
  if(!report.reset&&report.includeImages===false)$('reportSummary').textContent+=' · 已忽略图片';
  const rows=report.items.map(item=>`<tr><td>${escape(item.label)}<br><small style="color:#a4afbf;font-size:9px">${escape(item.id)}</small></td><td><span class="status-pill ${item.status}">${statusNames[item.status]||escape(item.status)}</span></td><td>${escape(item.detail)}</td></tr>`).join('');
  $('reportBody').innerHTML=`<p class="small-hint" style="padding:0 16px">记录：${escape(report.draftName)} · 目标：${escape(report.tabTitle)}${c.upload?' · 图片已交上传控件，请核对是否上传成功。':''}</p>`+(rows?`<table class="report-table"><thead><tr><th>字段</th><th>结果</th><th>说明</th></tr></thead><tbody>${rows}</tbody></table>`:'<p class="empty">'+(report.reset?'之后可再次补填；要改写网页现有内容，请选择覆盖全部或覆盖后半部分。':'本次没有需要发送的字段，请先填写内容。')+'</p>');
}
async function fill(action='fill'){
  if(!extension){toast('请先按照压缩包内的使用说明安装 Chrome 扩展。这里仍可离线填写、导出草稿。');return;}
  if(busy||switching||locating)return;busy=true;renderRecordList();$('draftSelect').disabled=true;$('newDraft').disabled=true;$('importDraft').disabled=true;$('targetTab').disabled=true;$('fillBtn').disabled=true;$('resetHistory').disabled=true;
  document.body.classList.remove('records-open');syncQuickState();
  const old=$('fillBtn').textContent;$('fillBtn').textContent=action==='reset'?'正在清除…':'正在补填，请保持当前题目…';
  try{
    await imagePreferenceQueue;await saveNow();if(action==='fill'&&!usedCount(includeImages)){toast(includeImages?'请先填写需要发送的字段。':'没有需要导入的文字或排序；图片已设为忽略。');return;}
    const targetKey=$('targetTab').value;if(!targetKey)throw Error('请先选择目标题号。');
    const r=await chrome.runtime.sendMessage({type:'qf-fill',draftId:draft.id,targetKey,action});
    if(!r.ok)throw Error(r.error);if(r.result.draftId!==draft.id){const actual=await QFDB.get(r.result.draftId);if(actual){adoptDraft(actual);selectedTargetKey=r.result.targetKey;await settings.set({activeDraftId:actual.id});render();}}renderReport(r.result);await refreshTabs();$('reportBox').open=true;
    const c=r.result.counts;toast(action==='reset'?'本题补填记录已清除；网页内容保留。':`本次写入 ${c.filled} 个，${c.pending} 个待解锁，${c.error} 个未成功。请在原网页核对并暂存。`);
  }catch(e){toast(e.message);$('reportBox').open=true;}finally{busy=false;renderRecordList();$('draftSelect').disabled=false;$('newDraft').disabled=false;$('importDraft').disabled=false;$('targetTab').disabled=false;$('fillBtn').disabled=false;$('resetHistory').disabled=false;$('fillBtn').textContent=old;syncQuickState();}
}
$('fillBtn').onclick=()=>fill();
$('quickFill').onclick=()=>fill();
$('resetHistory').onclick=()=>fill('reset');
$('newDraft').onclick=async()=>{
  if(busy||switching)return;
  try{cancelTargetSelection();await saveNow();adoptDraft(blank(),false);draft.name='记录 '+(records.length+1);await settings.set({activeDraftId:draft.id});await saveNow();render();await refreshTabs();await loadReport();toast('已新建空白记录，可在右侧重命名。');}catch(e){toast(e.message);}
};
$('draftSelect').onchange=()=>selectDraft($('draftSelect').value).catch(e=>toast(e.message));
$('recordList').onclick=async event=>{
  const select=event.target.closest('[data-switch-record]');
  if(select){try{await selectDraft(select.dataset.switchRecord);}catch(e){toast(e.message);}return;}
  if(busy||switching)return;
  const archive=event.target.closest('[data-archive-record]');
  if(archive){await archiveRecord(archive.dataset.archiveRecord,archive.dataset.archiveTo==='true');return;}
  const remove=event.target.closest('[data-delete-record]');
  if(remove){await deleteRecord(remove.dataset.deleteRecord);return;}
  const rename=event.target.closest('[data-rename-record]');
  if(rename){renamingId=rename.dataset.renameRecord;const record=renamingId===draft.id?draft:records.find(r=>r.id===renamingId);$('renameName').value=record?.name||'';$('renameDialog').showModal();$('renameName').focus();$('renameName').select();}
};
$('renameForm').onsubmit=async event=>{
  event.preventDefault();const name=$('renameName').value.trim();if(!name){$('renameName').focus();return;}
  try{
    await saveNow();
    if(renamingId===draft.id){draft.name=name;$('draftName').value=name;markDraftDirty();await saveNow();updatePairing();}
    else{const record=await QFDB.get(renamingId);if(!record)throw Error('记录已删除');record.name=name;record.updatedAt=Date.now();await QFDB.put(record);await draftList();}
    $('renameDialog').close();toast('记录已重命名。');
  }catch(e){toast(e.message);}
};
$('cancelRename').onclick=()=>$('renameDialog').close();
$('toggleRecords').onclick=()=>{document.body.classList.toggle('records-open');syncQuickState();};
for(const button of document.querySelectorAll('[data-record-filter]'))button.onclick=()=>{
  if(busy||switching)return;
  recordFilter=button.dataset.recordFilter;renderRecordList();syncQuickState();
};
async function archiveRecord(id,archived){
  if(busy||switching)return;
  cancelTargetSelection();switching=true;syncQuickState();
  try{
    await saveNow();
    const saved=await QFDB.setArchived(id,archived);
    if(draft.id===id)adoptDraft(saved);
    await draftList();render();
    toast((archived?'已归档“':'已恢复“')+saved.name+'”。正文、截图和题号关联已保留。');
  }catch(error){toast('归档状态未更改：'+error.message);}
  finally{switching=false;syncQuickState();}
}
$('archiveDraft').onclick=()=>archiveRecord(draft.id,!draft.archived);
async function refreshArchiveRecords(){
  if(!draft||busy||switching||recordSwitchJob){archiveRefreshPending=true;return;}
  archiveRefreshPending=false;switching=true;syncQuickState();
  try{
    await saveNow();
    const current=await QFDB.get(draft.id);
    if(current&&draft.archived!==QFDB.isArchived(current)){
      draft.archived=QFDB.isArchived(current);recordFilter=draft.archived?'archived':'active';
    }
    await draftList();updatePairing();
  }finally{switching=false;syncQuickState();}
}
window.addEventListener('qf-archive-changed',()=>{archiveRefreshPending=true;syncQuickState();});
async function deleteRecord(id){
  if(busy||switching)return;
  cancelTargetSelection();switching=true;syncQuickState();
  try{
    const record=id===draft.id?draft:await QFDB.get(id);if(!record)throw Error('该记录已删除，请刷新列表');
    if(!confirm('删除“'+record.name+'”？将删除这条本机记录及其截图。原网页内容保留；如需保留记录，请先导出备份。'))return;
    await saveNow();const index=records.findIndex(r=>r.id===id),wasCurrent=draft.id===id;
    await QFDB.delete(id);delete targetAssignments[id];
    if(wasCurrent){
      const all=(await QFDB.summaries()).sort((a,b)=>(a.createdAt||a.updatedAt)-(b.createdAt||b.updatedAt)||a.id.localeCompare(b.id));
      const neighbor=all[Math.min(Math.max(index,0),all.length-1)];adoptDraft(neighbor?await QFDB.get(neighbor.id):blank(),!!neighbor);
      await settings.set({activeDraftId:draft.id});await saveNow();await draftList();render();
    }else await draftList();
    let warning='';
    try{
      if(extension){const r=await chrome.runtime.sendMessage({type:'qf-forget-record',draftId:id});if(!r.ok)throw Error(r.error);targetAssignments=r.result.draftTargets;}
      else{
        const stored=await settings.get(['reportsByTarget','lastReport']);
        await settings.set({reportsByTarget:Object.fromEntries(Object.entries(stored.reportsByTarget||{}).filter(([,r])=>r.draftId!==id)),...(stored.lastReport?.draftId===id?{lastReport:null}:{})});
      }
    }catch{warning='题号关联清理未完成，请刷新填写台。';}
    await settings.set({recordDeleted:{id,at:Date.now()}});
    await refreshTabs();await loadReport();toast('已删除“'+record.name+'”及其本机截图。原网页内容保留。'+warning);
  }catch(e){toast('删除失败：'+e.message);}
  finally{switching=false;syncQuickState();}
}
$('deleteDraft').onclick=()=>deleteRecord(draft.id);
async function fileToJSON(file){
  const bytes=new Uint8Array(await file.arrayBuffer());let b='';for(let i=0;i<bytes.length;i+=16384)b+=String.fromCharCode(...bytes.subarray(i,i+16384));
  return {name:file.name,type:file.type,lastModified:file.lastModified,base64:btoa(b)};
}
$('exportDraft').onclick=async()=>{
  try{
    try{await saveNow();}catch(e){if(!await QFShared.enabled())throw e;}
    const attachments={};for(const [key,files]of Object.entries(draft.attachments))attachments[key]=await Promise.all(files.map(fileToJSON));
    const exported={...draft,attachments};delete exported._shared;
    const backup={format:'quality-fill-backup',version:1,exportedAt:new Date().toISOString(),draft:exported};
    const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=draft.name.replace(/[\\/:*?"<>|]/g,'_')+'.专家记录.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);toast('已导出草稿，包含已选择的截图。');
  }catch(e){toast('导出失败：'+e.message);}
};
$('importDraft').onclick=()=>$('importFile').click();
$('importFile').onchange=async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;if(busy||switching){toast('正在补填或切换记录，请稍后导入。');return;}
  try{
    cancelTargetSelection();switching=true;syncQuickState();await saveNow();
    $('libraryImportNotice').textContent='';
    const data=JSON.parse(await file.text());
    if(QFRecordLibrary.isBackup(data)){
      $('libraryImportNotice').textContent='正在读取开放题记录库备份和截图…';
      const result=await QFRecordLibrary.importBackup(data,(done,total)=>{$('libraryImportNotice').textContent='正在解析记录和截图 '+done+' / '+total+'…';});
      if(result.activeDraftId)await settings.set({activeDraftId:result.activeDraftId});
      await showRestoredLibrary(result);
      const message='已从开放题记录库导入 '+result.count+' 条，跳过 '+result.skipped+' 条已存在记录。'+(result.warnings?'有 '+result.warnings+' 项填写提醒，请查看记录来源信息。':'');
      $('libraryImportNotice').textContent=message;toast(message);return;
    }
    if(data.format==='quality-fill-library'){
      await saveNow();switching=true;syncQuickState();
      try{const result=await QFPortable.importLibrary(data,true);await showRestoredLibrary(result);toast('已合并导入 '+result.count+' 条记录及图片。');}finally{switching=false;syncQuickState();}
      return;
    }
    if(data.format!=='quality-fill-backup'||data.version!==1||!data.draft||typeof data.draft.values!=='object')throw Error('不是本工具导出的记录文件');
    await saveNow();const fresh=blank(),source=data.draft;if(source.rankingVersion===2)fresh.rankingVersion=2;if(source.archived!==undefined&&typeof source.archived!=='boolean')throw Error('归档状态无效');fresh.archived=QFDB.isArchived(source);if(source.recordLibrary&&typeof source.recordLibrary==='object'&&!Array.isArray(source.recordLibrary))fresh.recordLibrary=structuredClone(source.recordLibrary);fresh.name=String(source.name||'导入记录');if(source.overwriteMode!==undefined&&!['none','all','later'].includes(source.overwriteMode))throw Error('覆盖模式无效');fresh.overwriteMode=QFSchema.overwriteMode(source);fresh.overwrite=fresh.overwriteMode==='all';fresh.syncRanking=!!source.syncRanking;fresh.ranks={};
    for(const [key]of QFSchema.models)fresh.ranks[key]=String(source.ranks?.[key]||'');
    for(const f of QFSchema.fields){
      if(f.type!=='file'){if(typeof source.values[f.id]==='string')fresh.values[f.id]=source.values[f.id];continue;}
      fresh.attachments[f.id]=[];
      for(const image of source.attachments?.[f.id]||[]){
        if(typeof image.base64!=='string'||image.base64.length>29*1024*1024||!String(image.type).startsWith('image/'))throw Error('备份包含无效或过大的截图');
        const b=atob(image.base64),bytes=new Uint8Array(b.length);for(let i=0;i<b.length;i++)bytes[i]=b.charCodeAt(i);
        if(bytes.length>20*1024*1024)throw Error('截图超过 20MB');
        fresh.attachments[f.id].push(new File([bytes],String(image.name||'image.png'),{type:image.type,lastModified:Number(image.lastModified)||Date.now()}));
      }
    }
    cancelTargetSelection();adoptDraft(fresh,false);await settings.set({activeDraftId:draft.id});await saveNow();render();await refreshTabs();await loadReport();toast('已导入为一条新记录，原有记录保留。');
  }catch(e){$('libraryImportNotice').textContent='导入失败：'+e.message;toast('导入失败：'+e.message);}
  finally{switching=false;syncQuickState();}
};
$('helpBtn').onclick=()=>$('helpDialog').showModal();$('closeHelp').onclick=()=>$('helpDialog').close();
$('openFull').onclick=()=>{if(extension)chrome.runtime.sendMessage({type:'qf-editor'});else window.open('app.html','_blank');};
async function refreshAfterDeletion(id){
  if(!draft||busy||switching)return;
  switching=true;syncQuickState();
  try{
    if(draft.id===id){
      clearTimeout(saveTimer);await saveQueue.catch(()=>{});
      const {activeDraftId}=await settings.get(['activeDraftId']),all=await QFDB.summaries();
      const next=all.find(r=>r.id===activeDraftId)||all[0];adoptDraft(next?await QFDB.get(next.id):blank(),!!next);
      if(!all.length)await saveNow();
      await settings.set({activeDraftId:draft.id});render();
    }
    await draftList();await refreshTabs();await loadReport();
    window.dispatchEvent(new Event('qf-records-changed'));
  }finally{switching=false;syncQuickState();}
}
if(extension)chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'&&changes.includeImages){includeImages=changes.includeImages.newValue!==false;syncImageOptions();}
  if(!draft)return;
  if(area==='local'&&changes.recordDeleted?.newValue?.id)refreshAfterDeletion(changes.recordDeleted.newValue.id).catch(e=>toast(e.message));
  if(area==='session'&&changes.draftTargets){
    targetAssignments=changes.draftTargets.newValue||{};targetRevision++;
    if(!locating)applyTargetSelection();if(!busy&&!locating)loadReport().catch(e=>toast(e.message));
  }
  if(area==='session'&&(changes.platformRevision||changes.platformSelection)||area==='local'&&Object.keys(changes).some(key=>key.startsWith('questionRecordBindings'))){refreshTabs().then(()=>followPlatform(changes.platformSelection?.newValue)).catch(error=>toast(error.message));}
  if(area==='local'&&changes.lastReport){const r=changes.lastReport.newValue;if(r?.draftId===draft.id&&r.targetKey===$('targetTab').value)renderReport(r);}
  if(area==='local'&&!selectedTargetKey&&changes.activeDraftId&&changes.activeDraftId.newValue!==draft.id)selectDraft(changes.activeDraftId.newValue,true).catch(e=>toast(e.message));
});
window.addEventListener('pagehide',()=>{if(draft)saveNow().catch(()=>{});});
window.addEventListener('blur',()=>{if(draft)saveNow().catch(()=>{});});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&draft)saveNow().catch(()=>{});});
async function showRestoredLibrary(result){
  if(result.activeDraftId){cancelTargetSelection();adoptDraft(await QFDB.get(result.activeDraftId));}
  render();await draftList();await refreshTabs();await loadReport();
}
(async()=>{
  if(extension)editorWindowId=(await chrome.windows.getCurrent()).id;
  includeImages=(await settings.get(['includeImages'])).includeImages!==false;syncImageOptions();
  await QFPortable.init({
    getActiveId:async()=>draft?.id||(await settings.get(['activeDraftId'])).activeDraftId,
    setActiveId:id=>settings.set({activeDraftId:id}),
    beforeSave:async()=>{if(busy||switching)throw Error('正在补填或切换记录，请稍后操作');await saveNow();},
    beginRestore:()=>{switching=true;syncQuickState();},endRestore:()=>{switching=false;syncQuickState();},afterRestore:showRestoredLibrary
  });
  const stored=await settings.get(['activeDraftId','lastReport']);
  let loaded=stored.activeDraftId?await QFDB.get(stored.activeDraftId):null;
  if(await QFShared.enabled()){
    if(!loaded){const list=await QFDB.summaries(),first=list.find(row=>!row.archived)||list[0];if(first)loaded=await QFDB.get(first.id);}
    const pending=await QFShared.pending(stored.activeDraftId||loaded?.id);
    if(pending){loaded=pending;toast('已恢复上次未保存的修改，正在尝试同步。');adoptDraft(loaded,false);}
    else adoptDraft(loaded||blank(),!!loaded);
  }else adoptDraft(loaded||blank(),!!loaded);
  await draftList();await settings.set({activeDraftId:draft.id});render();await saveNow();await refreshTabs();if(extension)await followPlatform((await chrome.storage.session.get('platformSelections')).platformSelections?.[editorWindowId]);await loadReport();
})().catch(e=>{toast('初始化失败：'+e.message);$('saveState').textContent='初始化失败，请刷新';});
if(extension&&new URLSearchParams(location.search).has('panel')){
  chrome.windows.getCurrent().then(window=>chrome.runtime.sendMessage({type:'qf-panel-visible',windowId:window.id})).catch(()=>{});
}

if(extension){setInterval(()=>{if(!document.hidden&&!busy&&!switching&&!locating)refreshTabs().catch(()=>{});},2000);window.addEventListener('focus',()=>refreshTabs().catch(()=>{}));}
