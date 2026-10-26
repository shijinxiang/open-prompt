/* Question identity is independent of a browser tab. Writes are serialized. */
(function(root){
  const validQuestion=id=>/^\d{12,24}$/.test(String(id||''));
  function create({storage,db}){
    const originalStorage=storage;
    async function scope(){const c=await root.QFShared?.config();return c?.enabled?':shared:'+c.libraryId:'';}
    const scopedKey=(key,suffix)=>['questionRecordBindings','questionRecordBindingsVersion'].includes(key)?key+suffix:key;
    storage={...originalStorage,local:{async get(keys){const suffix=await scope(),list=typeof keys==='string'?[keys]:keys;const result=await originalStorage.local.get(list.map(key=>scopedKey(key,suffix)));const out=Object.fromEntries(list.map(key=>[key,suffix&&key==='reportsByTarget'?{}:result[scopedKey(key,suffix)]]));return out;},async set(values){const suffix=await scope();return originalStorage.local.set(Object.fromEntries(Object.entries(values).map(([key,value])=>[scopedKey(key,suffix),value])));}},session:{...originalStorage.session,async get(keys){if(await scope()&&keys==='questionDraftBindings')return {questionDraftBindings:{}};return originalStorage.session.get(keys);}}};
    let queue=Promise.resolve(),ready=null;
    let readyScope=null;
    const serial=work=>{const result=queue.catch(()=>{}).then(work);queue=result;return result;};
    const clean=value=>Object.fromEntries(Object.entries(value||{}).filter(([id,binding])=>validQuestion(id)&&typeof binding?.draftId==='string'&&binding.draftId));
    async function init(){
      const currentScope=await scope();if(readyScope!==currentScope){ready=null;readyScope=currentScope;}
      if(!ready)ready=serial(async()=>{
        const local=await storage.local.get(['questionRecordBindings','questionRecordBindingsVersion','reportsByTarget']);
        if(local.questionRecordBindingsVersion===1)return;
        const bindings=clean(local.questionRecordBindings),{questionDraftBindings={}}=await storage.session.get('questionDraftBindings');
        if(currentScope){
          const old=clean((await originalStorage.local.get('questionRecordBindings')).questionRecordBindings);
          for(const [id,binding]of Object.entries(old)){const row=await db.get(binding.draftId);if(row&&!bindings[id])bindings[id]={...binding,draftId:row.id};}
        }
        const add=async(id,draftId,at)=>{if(!validQuestion(id)||bindings[id]||!draftId||!await db.get(draftId))return;bindings[id]={draftId,firstDraftId:draftId,revision:1,boundAt:Number(at)||Date.now(),updatedAt:Number(at)||Date.now()};};
        // Preserve existing explicit associations; older reports only fill gaps.
        for(const [key,binding]of Object.entries(questionDraftBindings)){const match=key.match(/^\d+:(\d{12,24})$/);if(match)await add(match[1],binding?.draftId,binding?.at);}
        for(const report of Object.values(local.reportsByTarget||{}).filter(report=>report&&!report.reset).sort((a,b)=>(a.at||0)-(b.at||0))){const id=report.questionId||String(report.targetKey||'').match(/^\d+:(\d{12,24})$/)?.[1];await add(id,report.draftId,report.at);}
        await storage.local.set({questionRecordBindings:bindings,questionRecordBindingsVersion:1});
      });
      try{await ready;}catch(error){ready=null;throw error;}
    }
    async function all(){await init();await queue.catch(()=>{});return clean((await storage.local.get('questionRecordBindings')).questionRecordBindings);}
    async function bind(questionId,draftId,replace=false){
      await init();
      return serial(async()=>{
        if(!validQuestion(questionId)||typeof draftId!=='string'||!draftId)throw Error('题号或记录无效');
        const bindings=clean((await storage.local.get('questionRecordBindings')).questionRecordBindings),old=bindings[questionId];
        if(old&&!replace)return old;
        const record=await db.get(draftId);if(!record)throw Error('记录已删除，请手动选择其他记录');
        if(db.isArchived(record))throw Error('这条记录已归档，请先恢复后再绑定题号');
        if(old?.draftId===draftId)return old;
        const now=Date.now(),binding={draftId,firstDraftId:old?.firstDraftId||old?.draftId||draftId,revision:(Number(old?.revision)||0)+1,boundAt:old?.boundAt||now,updatedAt:now,manual:!!replace};
        bindings[questionId]=binding;await storage.local.set({questionRecordBindings:bindings});return binding;
      });
    }
    async function forget(draftId){await init();return serial(async()=>{const bindings=clean((await storage.local.get('questionRecordBindings')).questionRecordBindings);for(const [id,binding]of Object.entries(bindings))if(binding.draftId===draftId)delete bindings[id];await storage.local.set({questionRecordBindings:bindings});});}
    async function verify(questionId,draftId,revision){const binding=(await all())[questionId];if(!binding||binding.draftId!==draftId||binding.revision!==revision)throw Error('该题号的绑定已更改，已停止本次导入，请核对后重试');return binding;}
    return {init,all,bind,forget,verify};
  }
  root.QFBindings={create,validQuestion};
})(globalThis);
