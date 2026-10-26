/* Self-contained: Chrome serializes this function into the target frame. */
globalThis.qualityFillEngine = async function qualityFillEngine(payload) {
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const norm=s=>String(s??'').replace(/\r\n/g,'\n').trim();
  const overwriteMode=['none','all','later'].includes(payload.overwriteMode)?payload.overwriteMode:payload.overwrite?'all':'none';
  const canOverwrite=field=>overwriteMode==='all'||overwriteMode==='later'&&(['arena1','arena2','ranking'].includes(field.section)||/^(arena[12]-|ranking-)/.test(field.id));
  async function imageSignature(files){
    const parts=[];
    for(const file of files){const hash=file.sha256||Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(file.base64)))).map(byte=>byte.toString(16).padStart(2,'0')).join('');parts.push([file.name,file.type,hash]);}
    return JSON.stringify(parts);
  }
  function roots() {
    const found=[document];
    for(let i=0;i<found.length;i++) for(const node of found[i].querySelectorAll('*')) if(node.shadowRoot) found.push(node.shadowRoot);
    return found;
  }
  const all=selector=>roots().flatMap(r=>Array.from(r.querySelectorAll(selector)));
  const byId=id=>all(`[data-field-id="${CSS.escape(id)}"]`)[0];
  const parent=e=>e?.parentElement || e?.getRootNode()?.host || null;
  function visible(el,allowHiddenInput=false) {
    if(!el?.isConnected) return false;
    if(el instanceof HTMLInputElement && ['radio','checkbox','file'].includes(el.type) && allowHiddenInput) el=el.closest('label')||parent(el);
    for(let e=el;e;e=parent(e)) {
      const s=getComputedStyle(e);
      if(e.hidden||e.getAttribute('aria-hidden')==='true'||e.hasAttribute('inert')||s.display==='none'||s.visibility==='hidden'||s.visibility==='collapse')return false;
    }
    return !!el.getClientRects().length;
  }
  function locked(el) {
    for(let e=el;e;e=parent(e)) {
      if(e.disabled||e.readOnly||e.getAttribute('aria-disabled')==='true'||e.getAttribute('aria-readonly')==='true'||e.hasAttribute('inert')||e.classList.contains('ant-select-disabled'))return true;
      const hiddenNative=e===el&&e instanceof HTMLInputElement&&['radio','checkbox','file'].includes(e.type);
      if(!hiddenNative&&getComputedStyle(e).pointerEvents==='none')return true;
    }
    return false;
  }
  function taskKey() {
    const url=new URL(location.href);
    const identity=['itemID','itemId','item_id','questionId','question_id','taskId','task_id'].map(k=>[k,url.searchParams.get(k)]).filter(x=>x[1]);
    // AIDP displays a distinct item ID even when a route updates without query changes.
    const label=all('span,div').find(e=>e.children.length===0 && /^题目\s*ID[：:]?\s*$/.test(norm(e.textContent)));
    const near=label?.parentElement?.textContent?.match(/题目\s*ID[：:]?\s*(\d{8,})/);
    return url.origin+url.pathname+'|'+JSON.stringify(identity)+'|'+(near?.[1]||'');
  }
  function targetValid(){
    if(!payload.platformOnly&&!payload.expectedQuestionId)return true;
    if(payload.platformOnly&&(location.origin!=='https://aidp.bytedance.com'||!document.title.includes('AI数据服务平台')))return false;
    let domId=null,urlId=null;const url=new URL(location.href);
    for(const key of ['itemID','itemId','item_id','questionId','question_id']){const value=url.searchParams.get(key);if(/^\d{12,24}$/.test(value||'')){urlId=value;break;}}
    for(const e of all('[data-current-question-id]')){if(!visible(e))continue;const value=e.getAttribute('data-current-question-id');if(/^\d{12,24}$/.test(value||'')){domId=value;break;}}
    if(!domId)for(const e of all('span,div,label,strong')){
      if(e.children.length||!visible(e))continue;
      const text=String(e.textContent||'').replace(/\s+/g,' ').trim();
      const inline=text.match(/^题目\s*(?:ID|编号|题号)\s*[：:]?\s*(\d{12,24})$/i);if(inline){domId=inline[1];break;}
      if(/^题目\s*(?:ID|编号|题号)\s*[：:]?$/i.test(text)){
        const next=String(e.nextElementSibling?.textContent||'').trim();
        const match=String(e.parentElement?.textContent||'').match(/题目\s*(?:ID|编号|题号)\s*[：:]?\s*(\d{12,24})/i);
        domId=/^\d{12,24}$/.test(next)?next:match?.[1]||null;if(domId)break;
      }
    }
    return (!domId||!urlId||domId===urlId)&&(!payload.expectedQuestionId||(domId||urlId)===payload.expectedQuestionId);
  }
  if(!targetValid())return {recognized:true,stale:true,items:[]};
  const task=taskKey(), memoKey='__quality_fill_history_v1';
  const stillSame=()=>taskKey()===task&&targetValid();
  let memo={};try{memo=JSON.parse(sessionStorage.getItem(memoKey)||'{}');}catch{}
  const key=task+'|'+payload.draftId;
  const memory=globalThis.__qualityFillMemoryV1 ||= {};
  const history=memory[key] ||= (memo[key]||{});
  const save=()=>{memo[key]=history;const keys=Object.keys(memo);while(keys.length>40)delete memo[keys.shift()];try{sessionStorage.setItem(memoKey,JSON.stringify(memo));}catch{}};
  if(payload.action==='reset'){delete memory[key];delete memo[key];try{sessionStorage.setItem(memoKey,JSON.stringify(memo));}catch{}return {recognized:!!byId('authoring-section')||!!byId('question-input'),reset:true,task,items:[]};}
  if(payload.action==='probe')return {recognized:!!byId('authoring-section')||!!byId('question-input'),task,items:[]};
  const items=[];const recognized=!!byId('authoring-section')||!!byId('question-input')||!!byId('doubao-markdown-input');
  if(!recognized)return {recognized:false,task,items:[]};
  if(globalThis.__qualityFillRunningV1)return {recognized:true,task,items:[],busy:true};
  globalThis.__qualityFillRunningV1=true;
  const add=(f,status,detail)=>items.push({id:f.id,label:f.label,status,detail});
  function read(f,el) {
    if(f.type==='radio')return el.querySelector('input:checked')?.value||'';
    if(f.type==='select')return el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent||'' : el.querySelector('.ant-select-selection-item')?.textContent||'';
    if(f.type==='file')return Array.from(el.files||[]).map(x=>x.name).join(',');
    return el.value??'';
  }
  async function selectOption(el,text) {
    if(el instanceof HTMLSelectElement) {
      const option=Array.from(el.options).find(o=>norm(o.textContent)===norm(text)||o.value===text);
      if(!option)throw Error('网页下拉框没有该选项，请核对选项文字');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,option.value);
      el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));return;
    }
    const trigger=el.querySelector('.ant-select-selector')||el;
    trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));trigger.click();
    let option;
    for(let i=0;i<16;i++) {
      await delay(90);
      const combo=el.querySelector('[role="combobox"]');const listId=combo?.getAttribute('aria-controls')||combo?.getAttribute('aria-owns');
      let scope=listId?all(`[id="${CSS.escape(listId)}"]`)[0]:null;
      scope=scope?.closest('.ant-select-dropdown')||scope;
      const choices=scope?Array.from(scope.querySelectorAll('.ant-select-item-option,[role="option"]')):all('.ant-select-dropdown .ant-select-item-option,[role="listbox"] [role="option"]');
      option=choices.find(o=>visible(o)&&o.getAttribute('aria-disabled')!=='true'&&!o.classList.contains('ant-select-item-option-disabled')&&norm(o.querySelector('.ant-select-item-option-content')?.textContent||o.textContent)===norm(text));
      if(option)break;
      if(i===5 && combo && !combo.readOnly) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(combo,text);combo.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
      }
    }
    if(!option){el.querySelector('input')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));throw Error('未找到可点击的同名选项；请在原网页手动选择后再补填');}
    option.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,view:window}));option.click();
  }
  async function drag(source,target) {
    const dt=new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:dt}));await delay(90);
    target.dispatchEvent(new DragEvent('dragenter',{bubbles:true,cancelable:true,dataTransfer:dt}));
    target.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));
    target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));
    source.dispatchEvent(new DragEvent('dragend',{bubbles:true,cancelable:true,dataTransfer:dt}));await delay(180);
  }
  const ranks=()=>all('[data-field-id^="ranking-group-"]').filter(e=>visible(e)).map(e=>Array.from(e.querySelectorAll('[data-field-id^="ranking-drag-"]')).map(x=>x.dataset.fieldId.replace('ranking-drag-',''))).filter(g=>g.length);
  const rankSignature=groups=>groups.map(g=>[...g].sort().join(',')).join('|');
  try {
    for(const f of payload.fields) {
      if(!stillSame()){add(f,'pending','检测到题目切换，已停止本次填写');break;}
      const value=f.value;
      if(f.type==='file' ? !value?.length : !norm(value))continue;
      const overwrite=canOverwrite(f),signature=f.type==='file'?await imageSignature(value):null;
      let el=byId(f.id);
      if(history[f.id]&&(f.type==='file'?(!overwrite||history[f.id].signature===signature):!overwrite&&el&&norm(read(f,el)))){add(f,'done','本工具已填写，跳过');continue;}
      if(!el){add(f,'pending',f.inferred?'尚未找到此条件字段，出现后再尝试':'字段尚未出现，解锁后再补填');continue;}
      if(!visible(el,f.type==='file')){add(f,'pending','当前隐藏或折叠，请展开 / 解锁后再补填');continue;}
      // Radio inputs may be visually hidden by Ant Design; the group determines visibility.
      if(locked(el)){add(f,'pending','当前不可编辑，解锁后再补填');continue;}
      if(f.type==='file'){
        const model=f.id.replace('-screenshot-file-input','');
        const upload=byId(model+'-screenshot-upload');
        const card=byId(model+'-response-card');
        const hasPreview=!!card?.querySelector('[data-field-id^="'+CSS.escape(model)+'-screenshot-delete-"]');
        if(!overwrite && (el.files?.length||hasPreview)){add(f,'occupied','网页已有截图，已保留');continue;}
        if(upload && locked(upload)){add(f,'pending','截图上传区尚未解锁');continue;}
      }
      const current=norm(read(f,el));const desired=norm(value);
      if(f.type!=='file' && current && !['请选择','请选择领域','请选择题目领域'].includes(current)){
        if(current===desired){history[f.id]=true;add(f,'same','内容一致，已记为完成');save();continue;}
        if(!overwrite){add(f,'occupied','网页已有内容，已保留');continue;}
      }
      if(f.max && String(value).length>f.max){add(f,'error',`超过网页 ${f.max} 字符限制，请缩短后重试`);continue;}
      try {
        if(f.type==='radio'){
          const input=Array.from(el.querySelectorAll('input[type="radio"]')).find(i=>i.value===value);
          if(!input||locked(input))throw Error('对应单选项不存在或不可编辑');
          input.click();
        }else if(f.type==='select')await selectOption(el,value);
        else if(f.type==='file'){
          const dt=new DataTransfer();
          for(const file of value){
            const binary=atob(file.base64);const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
            dt.items.add(new File([bytes],file.name,{type:file.type,lastModified:file.lastModified}));
          }
          if(overwrite){
            const model=f.id.replace('-screenshot-file-input','');
            const existing=()=>Array.from(byId(model+'-response-card')?.querySelectorAll('[data-field-id^="'+CSS.escape(model)+'-screenshot-delete-"]')||[]);
            const deletes=existing();
            if(deletes.some(button=>!visible(button)||locked(button)))throw Error('已有截图当前无法替换，请解锁或手动移除后重试');
            for(let count=0;count<deletes.length;count++){
              if(!stillSame())throw Error('题号已切换，停止替换截图');
              const button=existing()[0];if(!button)break;button.click();
              for(let wait=0;wait<12&&button.isConnected;wait++)await delay(80);
              if(button.isConnected)throw Error('网页尚未移除原截图，请核对后重试');
            }
            el=byId(f.id);if(!el||locked(el))throw Error('截图上传区已变化，请核对后重试');
          }
          el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
        }else{
          if(!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement))throw Error('该字段当前不是可编辑文本框');
          const limit=el.maxLength;if(limit>=0&&String(value).length>limit)throw Error(`超过网页 ${limit} 字符限制`);
          const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto,'value').set.call(el,String(value));
          el.dispatchEvent(new Event('input',{bubbles:true,composed:true}));
          el.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
          el.dispatchEvent(new FocusEvent('blur',{bubbles:true,composed:true}));
        }
        await delay(f.type==='select'?260:160);
        if(!stillSame()){add(f,'pending','检测到题目切换，请核对当前题目后再试');break;}
        el=byId(f.id);
        if(f.type==='file'){
          // The upload control may clear its file list while uploading. Do not send a second upload automatically.
          history[f.id]={signature};add(f,'upload','已交给上传控件，请核对网页上传结果');
        }else if(el&&norm(read(f,el))===desired){history[f.id]=true;add(f,'filled','已写入');}
        else add(f,'error','网页未保留该值，请检查是否解锁后再试');
        save();
      }catch(error){add(f,'error',error.message||'填写失败，请重试');}
    }
    if(payload.ranking?.length && stillSame()){
      const f={id:'overall-ranking',label:'模型达成性排序',section:'ranking'};
      const wanted=payload.ranking;
      if(history[f.id]&&!canOverwrite(f))add(f,'done','本工具已同步排序，跳过');
      else if(!visible(byId('ranking-drag-list'))||locked(byId('ranking-drag-list')))add(f,'pending','排序区尚未出现或未解锁');
      else if(rankSignature(ranks())===rankSignature(wanted)){history[f.id]=true;add(f,'same','排序一致');save();}
      else{
        try {
          for(const model of wanted.flat()){
            if(!stillSame())throw Error('题目已切换，停止排序');
            const source=byId('ranking-drag-'+model),target=byId('ranking-new-rank-dropzone');
            if(!visible(source)||!visible(target)||locked(source)||locked(target))throw Error('排序拖动区域尚未解锁');
            await drag(source,target);
          }
          for(const group of wanted)for(const model of group.slice(1)){
            if(!stillSame())throw Error('题目已切换，停止排序');
            const anchor=byId('ranking-drag-'+group[0]);const target=anchor?.closest('[data-field-id^="ranking-group-"]');
            if(!target)throw Error('无法定位名次框，请手动调整排序');
            await drag(byId('ranking-drag-'+model),target);
          }
          if(rankSignature(ranks())!==rankSignature(wanted))throw Error('网页未接受完整排序，请核对并手动调整名次');
          history[f.id]=true;add(f,'filled','已同步排序');save();
        }catch(e){add(f,'error',e.message);}
      }
    }
    // Catch delayed controlled-component re-renders before declaring success.
    await delay(360);
    if(stillSame())for(const item of items.filter(x=>x.status==='filled'&&x.id!=='overall-ranking')){
      const f=payload.fields.find(f=>f.id===item.id),el=byId(item.id);
      if(el&&norm(read(f,el))!==norm(f.value)){
        delete history[item.id];item.status='error';item.detail='网页随后回退了该值，尚未记为完成';
      }
    }
    save();return {recognized:true,task,items,stale:!stillSame()};
  } finally {globalThis.__qualityFillRunningV1=false;}
};
