(function(root){
  const pattern='https://aidp.bytedance.com/*';
  function allowed(tab){try{const url=new URL(tab?.url||'');return url.origin==='https://aidp.bytedance.com'&&String(tab.title||'').includes('AI数据服务平台');}catch{return false;}}
  function key(tabId,questionId){return String(tabId)+':'+questionId;}
  function scope(tab){try{const url=new URL(tab.url);for(const name of ['itemID','itemId','item_id','questionId','question_id'])url.searchParams.delete(name);url.searchParams.sort();return url.href;}catch{return '';}}
  function parse(value){const match=String(value||'').match(/^(\d+):(\d{12,24})$/);if(!match)throw Error('请先选择完整题号');return {tabId:Number(match[1]),questionId:match[2]};}
  function questionURL(tab,scan,questionId){
    if(!allowed(tab)||!/^\d{12,24}$/.test(questionId))throw Error('无效的平台题号');
    const url=new URL(tab.url);
    // Keep the real platform route, task parameters and hash. Only replace a
    // recognized question parameter whose value matches the observed page.
    if(scan.consistent&&scan.currentQuestionId)for(const name of ['itemID','itemId','item_id','questionId','question_id']){
      if(url.searchParams.get(name)===scan.currentQuestionId){url.searchParams.set(name,questionId);break;}
    }
    return url.href;
  }
  function targets(scans){
    const list=[];
    const retired=new Set(scans.flatMap(value=>value.scan?.retiredQuestionIds||[]));
    const catalog=tab=>scope(tab)+'|'+tab.windowId;
    const authoritative=new Map(),priorities=new Map();
    for(const value of scans)if(value.scan?.authoritativeList){
      const key=catalog(value.tab),priority=value.tab.active?3:value.tab.recentPlatform?2:1,old=priorities.get(key);
      if(!old||priority>old.priority||priority===old.priority&&(value.tab.lastAccessed||0)>old.at){priorities.set(key,{priority,at:value.tab.lastAccessed||0});authoritative.set(key,new Set((value.scan.questions||[]).map(q=>q.questionId)));}
    }
    for(const {tab,scan}of scans){
      if(!allowed(tab)||!scan?.allowed)continue;
      const seen=new Set();
      for(const q of scan.questions||[]){
        if(!/^\d{12,24}$/.test(q.questionId)||seen.has(q.questionId)||retired.has(q.questionId)||authoritative.has(catalog(tab))&&!authoritative.get(catalog(tab)).has(q.questionId))continue;
        seen.add(q.questionId);const id=key(tab.id,q.questionId);
        list.push({id,key:id,tabId:tab.id,windowId:tab.windowId,questionId:q.questionId,current:scan.currentQuestionId===q.questionId,label:q.questionId});
      }
    }
    const groups=new Map();for(const item of list){if(!groups.has(item.questionId))groups.set(item.questionId,[]);groups.get(item.questionId).push(item);}
    const result=[];
    for(const group of groups.values()){
      const current=group.filter(item=>item.current),chosen=current.length?current:group.slice(0,1);
      chosen.forEach((item,i)=>{if(chosen.length>1)item.label=item.questionId+'（网页'+(i+1)+'）';result.push(item);});
    }
    return result;
  }
  root.QFTabs={pattern,allowed,key,parse,targets,questionURL,scope};
})(globalThis);
