/* Read-only page observation. Submission is always performed by the user. */
(function(){
  if(globalThis.__qualityPlatformWatchV1)return;globalThis.__qualityPlatformWatchV1=true;
  let timer=null,last='',intent=null,scanning=false,again=false;
  const norm=text=>String(text||'').replace(/\s+/g,' ').trim();
  const notices=()=>Array.from(document.querySelectorAll('[role="alert"],[role="status"],.ant-message-notice-content')).filter(node=>node.getClientRects().length&&/提交成功|题目已提交|归档成功/.test(norm(node.textContent)));
  document.addEventListener('click',event=>{
    const button=event.target.closest('button,[role="button"]');if(!button||!/^确认提交|^提交|^确认归档|^归档$/.test(norm(button.textContent)))return;
    const before=new Set(notices()),at=Date.now();
    qualityQuestionProbe({action:'identity'}).then(scan=>{if(scan.allowed&&scan.consistent&&scan.currentQuestionId)intent={questionId:scan.currentQuestionId,at,before};}).catch(()=>{});
  },true);
  async function scan(){
    if(scanning){again=true;return;}scanning=true;
    try{
      if(location.origin!=='https://aidp.bytedance.com'||!document.title.includes('AI数据服务平台'))return;
      if(intent&&Date.now()-intent.at<30000&&notices().some(node=>!intent.before.has(node))){(globalThis.__qualitySubmittedQuestionsV1||=new Set()).add(intent.questionId);intent=null;}
      const value=await qualityQuestionProbe();
      const signature=JSON.stringify([location.href,value.currentQuestionId,value.consistent,value.authoritativeList,value.questions,value.retiredQuestionIds]);
      if(signature!==last){last=signature;await chrome.runtime.sendMessage({type:'qf-platform-changed',scan:value});}
    }catch{}finally{scanning=false;if(again){again=false;schedule();}}
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(scan,300);}
  const observer=new MutationObserver(records=>{if(records.every(record=>record.target.nodeType===1&&record.target.closest('[data-field-id$="-response-card"],[data-field-id$="-markdown-preview"],#__quality_fill_widget_v1')))return;schedule();});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-question-id','data-item-id','data-question-status','data-current-question-status','data-current-question-id','data-status','data-archived','class','hidden','aria-busy']});
  window.addEventListener('popstate',schedule);window.addEventListener('hashchange',schedule);document.addEventListener('visibilitychange',schedule);
  setInterval(()=>{if(!document.hidden)scan();},2000);schedule();
})();
