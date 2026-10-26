const $=id=>document.getElementById(id);
let tab,windowId,questionId,targetKey,choiceVersion=0;
(async()=>{
  [tab]=await chrome.tabs.query({active:true,currentWindow:true,url:'https://aidp.bytedance.com/*'});
  windowId=tab?.windowId??(await chrome.windows.getCurrent()).id;
  if(!tab){$('draft').textContent='请在AI数据服务平台题目页使用补填。';$('status').textContent='其他网页不会读取或填写。可打开填写台准备记录。';return;}
  const context=await chrome.runtime.sendMessage({type:'qf-tab-context',tabId:tab.id});if(!context.ok)throw Error(context.error);
  if(!context.result.allowed||!context.result.questionId){$('draft').textContent='尚未识别到AI数据服务平台的完整题号。';$('status').textContent='请打开对应题目并等待加载，再重试。';return;}
  questionId=context.result.questionId;targetKey=context.result.targetKey;
  const records=(await QFDB.summaries()).filter(row=>!QFDB.isArchived(row));
  $('recordChoice').replaceChildren(...records.map(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=r.name||'未命名记录';return o;}));
  if(records.some(r=>r.id===context.result.draftId))$('recordChoice').value=context.result.draftId;
  if(!records.length){$('draft').textContent='题号：'+questionId+'；请先打开填写台新建记录。';return;}
  if(context.result.bound&&!records.some(r=>r.id===context.result.draftId)){const o=document.createElement('option');o.value='';o.textContent='原记录已删除，请重新选择';$('recordChoice').prepend(o);$('recordChoice').value='';}
  $('draft').textContent='当前题号：'+questionId+(context.result.bound?'（固定绑定）':'')+' · '+(context.result.draftName||'请选择记录');
  $('recordChoice').disabled=false;$('fill').disabled=!$('recordChoice').value;
})().catch(e=>$('status').textContent=e.message);
$('recordChoice').onchange=async()=>{const version=++choiceVersion;$('fill').disabled=true;try{const result=await chrome.runtime.sendMessage({type:'qf-bind-record',draftId:$('recordChoice').value,targetKey});if(!result.ok)throw Error(result.error);if(version===choiceVersion)$('status').textContent=result.result.bound?'已人工更换本题绑定记录。':'已选择记录，首次导入后固定绑定。';}catch(error){$('status').textContent=error.message;$('recordChoice').value='';return;}finally{if(version===choiceVersion)$('fill').disabled=!questionId||!$('recordChoice').value;}};
$('fill').onclick=async()=>{
  $('fill').disabled=true;$('recordChoice').disabled=true;$('status').textContent='正在核对题号并补填…';
  try{const r=await chrome.runtime.sendMessage({type:'qf-fill',draftId:$('recordChoice').value,tabId:tab?.id,questionId});if(!r.ok)throw Error(r.error);const c=r.result.counts;$('draft').textContent='记录：'+r.result.draftName+' → '+r.result.tabTitle;$('status').textContent=`本次写入 ${c.filled}，已完成 ${c.done+c.same}，待解锁 ${c.pending}，保留已有 ${c.occupied}，失败 ${c.error}${c.upload?'，已交上传 '+c.upload:''}。`+(r.result.includeImages===false?'本次忽略图片。':'');}
  catch(e){$('status').textContent=e.message;}finally{$('fill').disabled=!questionId;$('recordChoice').disabled=false;}
};
$('panel').onclick=()=>{if(windowId===undefined){$('status').textContent='正在读取窗口，请稍后点击。';return;}chrome.sidePanel.open({windowId}).then(()=>window.close()).catch(e=>$('status').textContent=e.message);};
$('editor').onclick=()=>chrome.runtime.sendMessage({type:'qf-editor'}).then(()=>window.close());
