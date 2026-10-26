/* Self-contained: reads/selects questions only inside the approved platform page. */
globalThis.qualityQuestionProbe=async function qualityQuestionProbe(options={}){
  const allowed=()=>location.origin==='https://aidp.bytedance.com'&&document.title.includes('AI数据服务平台');
  if(!allowed())return {allowed:false,questions:[],currentQuestionId:null};
  const norm=s=>String(s||'').replace(/\s+/g,' ').trim();
  const id=s=>/^\d{12,24}$/.test(norm(s))?norm(s):null;
  let rootSnapshot=null;
  const cache=globalThis.__qualityQuestionNodesV2||=( {} );
  const roots=()=>{if(rootSnapshot)return rootSnapshot;const found=[document];for(let i=0;i<found.length;i++)for(const e of found[i].querySelectorAll('*'))if(e.shadowRoot)found.push(e.shadowRoot);return rootSnapshot=found;};
  const all=selector=>roots().flatMap(r=>Array.from(r.querySelectorAll(selector)));
  const parent=e=>e?.parentElement||e?.getRootNode()?.host||null;
  function visible(e){
    if(!e?.isConnected||!e.getClientRects().length)return false;
    for(let n=e;n;n=parent(n)){const s=getComputedStyle(n);if(n.hidden||s.display==='none'||s.visibility==='hidden'||n.getAttribute('aria-hidden')==='true')return false;}
    return true;
  }
  function current(){
    const url=new URL(location.href);let urlId=null,domId=null;
    for(const key of ['itemID','itemId','item_id','questionId','question_id']){urlId=id(url.searchParams.get(key));if(urlId)break;}
    if(cache.current?.isConnected&&visible(cache.current)){const text=norm(cache.current.textContent),m=text.match(/^题目\s*(?:ID|编号|题号)\s*[：:]?\s*(\d{12,24})$/i);domId=id(cache.current.getAttribute('data-current-question-id'))||m?.[1]||(/^题目\s*(?:ID|编号|题号)\s*[：:]?$/i.test(text)?id(cache.current.nextElementSibling?.textContent):null);}
    if(!domId)for(const e of all('[data-current-question-id]'))if(visible(e)){domId=id(e.getAttribute('data-current-question-id'));if(domId){cache.current=e;break;}}
    if(!domId)for(const e of all('span,div,label,strong')){
      if(e.children.length)continue;
      const text=norm(e.textContent),inline=text.match(/^题目\s*(?:ID|编号|题号)\s*[：:]?\s*(\d{12,24})$/i);
      if(inline&&visible(e)){domId=inline[1];cache.current=e;break;}
      if(/^题目\s*(?:ID|编号|题号)\s*[：:]?$/i.test(text)&&visible(e)){
        domId=id(e.nextElementSibling?.textContent);
        if(!domId){const m=norm(e.parentElement?.textContent).match(/题目\s*(?:ID|编号|题号)\s*[：:]?\s*(\d{12,24})/i);domId=m?.[1]||null;}
        if(domId){cache.current=e;break;}
      }
    }
    return {questionId:domId||urlId,domId,urlId,consistent:!domId||!urlId||domId===urlId};
  }
  function candidates(){
    const field=all('[data-field-id="question-input"]')[0];
    const limit=Math.max(180,Math.min(innerWidth*.4,field?field.getBoundingClientRect().left-12:560));
    const found=new Map();
    for(const e of all('[data-question-id],[data-item-id],span,div,li,button,a')){
      const q=id(e.getAttribute('data-question-id'))||id(e.getAttribute('data-item-id'))||(!e.children.length?id(e.textContent):null);
      if(!q||e.closest('textarea,input,[contenteditable="true"],[data-field-id="workspace-columns"],[data-field-id="authoring-section"],[data-field-id$="-response-card"],[data-field-id$="-markdown-preview"]')||!visible(e)||e.getBoundingClientRect().left>limit||/题目\s*(?:ID|编号|题号)\s*[：:]/i.test(norm(e.parentElement?.textContent)))continue;
      if(!found.has(q))found.set(q,e);
    }
    return found;
  }
  const now=current();
  const scopeURL=new URL(location.href);for(const name of ['itemID','itemId','item_id','questionId','question_id'])scopeURL.searchParams.delete(name);
  if(cache.scope!==scopeURL.href){cache.scope=scopeURL.href;cache.hadQuestionList=false;}
  const listed=candidates();
  const explicitLists=all('[data-question-list],[data-field-id="question-list"],[aria-label="题目列表"],[role="listbox"][aria-label*="题"],[class*="question-list"]');
  const listPresent=listed.size>0||explicitLists.some(visible)||cache.hadQuestionList;
  if(listed.size||explicitLists.some(visible))cache.hadQuestionList=true;
  function retired(questionId,element){
    if(globalThis.__qualitySubmittedQuestionsV1?.has(questionId))return true;
    let row=element?.closest('[data-question-row],[data-question-id],[data-item-id],[role="listitem"],[role="option"],li')||element;
    if(row===element&&element?.parentElement){const text=norm(element.parentElement.textContent),ids=new Set(text.match(/\d{12,24}/g)||[]);if(ids.size===1&&text.length<250)row=element.parentElement;}
    for(const node of [element,row].filter(Boolean)){
      const status=norm(node.getAttribute('data-question-status')||node.getAttribute('data-status')).toLowerCase();
      if(['submitted','completed','archived','已提交','已完成','已归档'].includes(status)||node.getAttribute('data-archived')==='true')return true;
      if(['pending','active','editing','未提交','未完成','待提交','进行中'].includes(status))continue;
      const text=norm(node.innerText??node.textContent),state=norm(text.replaceAll(questionId,'').replace(/题目|题号|编号|[：:]/g,''));
      if(text.length<250&&(/已提交|已归档/.test(text)||state==='已完成'))return true;
    }
    return false;
  }
  const retiredIds=Array.from(listed).filter(([questionId,element])=>retired(questionId,element)).map(([questionId])=>questionId);
  for(const questionId of globalThis.__qualitySubmittedQuestionsV1||[])if(!retiredIds.includes(questionId))retiredIds.push(questionId);
  const active=new Map(Array.from(listed).filter(([questionId])=>!retiredIds.includes(questionId)));
  const currentStatus=all('[data-current-question-id][data-question-status],[data-current-question-status]').find(node=>visible(node)&&(!node.getAttribute('data-current-question-id')||node.getAttribute('data-current-question-id')===now.questionId));
  if(currentStatus&&(['submitted','completed','archived','已提交','已完成','已归档'].includes(norm(currentStatus.getAttribute('data-current-question-status')||currentStatus.getAttribute('data-question-status')).toLowerCase()))){if(now.questionId&&!retiredIds.includes(now.questionId))retiredIds.push(now.questionId);active.delete(now.questionId);}
  const field=all('[data-field-id="question-input"]')[0];
  const unavailable=retiredIds.includes(now.questionId)||(listPresent?!active.has(now.questionId):!field||!visible(field));
  const loading=all('[aria-busy="true"],.ant-spin-spinning').some(visible)||!field||!visible(field);
  const snapshot={allowed:true,currentQuestionId:now.questionId,consistent:now.consistent,currentUnavailable:unavailable,loading,authoritativeList:!!listPresent,listedQuestionIds:Array.from(listed.keys()),retiredQuestionIds:retiredIds,href:location.href};
  if(options.action==='identity')return snapshot;
  if(options.action!=='select'){
    const list=Array.from(active.keys());if(!listPresent&&now.questionId&&!unavailable&&now.consistent&&!list.includes(now.questionId))list.unshift(now.questionId);
    return {...snapshot,questions:list.map(questionId=>({questionId}))};
  }
  const expected=id(options.questionId);if(!expected)return {allowed:true,error:'无效题号'};
  if(retiredIds.includes(expected)||listPresent&&!active.has(expected)&&!loading)return {allowed:true,error:'该题号已提交、已归档或已不在当前题目列表中，请刷新题号'};
  if(globalThis.__qualityFillRunningV1)return {allowed:true,error:'正在补填，请等待完成后再切题'};
  if(options.currentOnly&&(now.questionId!==expected||!now.consistent))return {allowed:true,error:'该标签页题号已变化，请重新选择目标题号'};
  if(now.questionId!==expected||!now.consistent){
    const row=active.get(expected);if(!row&&!loading)return {allowed:true,error:'左侧当前未加载这个题号，请在平台打开该题后刷新列表'};
    if(row){for(let e=row;e;e=parent(e))if(e.disabled||e.hasAttribute('inert')||e.getAttribute('aria-disabled')==='true'||getComputedStyle(e).pointerEvents==='none')return {allowed:true,error:'该题目当前不可点击，请在平台处理后再选择'};row.click();}
  }
  const deadline=Date.now()+10000;let stableSince=0;
  while(Date.now()<deadline){
    rootSnapshot=null;
    if(!allowed())return {allowed:false,error:'目标页面已离开AI数据服务平台'};
    const value=current(),field=all('[data-field-id="question-input"]')[0];
    if(options.currentOnly&&(value.questionId!==expected||!value.consistent))return {allowed:true,error:'该标签页题号已变化，请重新选择目标题号'};
    const loading=all('[aria-busy="true"],.ant-spin-spinning').some(visible);
    const fresh=candidates(),listedOK=!listPresent||fresh.has(expected)&&!retired(expected,fresh.get(expected));
    if(value.questionId===expected&&value.consistent&&field&&visible(field)&&!loading&&listedOK){stableSince||=Date.now();if(Date.now()-stableSince>=450)return {allowed:true,selected:true,questionId:expected,href:location.href};}else stableSince=0;
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  return {allowed:true,error:'尚未确认已切到该题号。请在平台处理未保存提示、切题确认或加载状态，再重试'};
};
