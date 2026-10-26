/* Lossless field adapter. Only edited fields are sent to the shared library. */
(function(root){
  const models=[['doubao','doubao','豆包专家'],['gpt','gpt56','GPT-5.6-Sol'],['opus','claude','Opus 4.6'],['model4','arena1',''],['model5','arena2','']];
  const types={'开放推荐类':'openRecommendation','分析决策类':'analysisDecision','How-to 类':'howTo'};
  const fields={'question-input':'prompt','question-domain-select':'field','insight-input':'insight','insight-description-input':'criteriaText','non-decisive-insight-description-input':'nonDecisiveCriteriaText','ranking-reason-input':'quality.rankingExplanation'};
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function plain(row){return {name:row.name,values:structuredClone(row.values||{}),ranks:structuredClone(row.ranks||{}),syncRanking:!!row.syncRanking,overwriteMode:root.QFSchema.overwriteMode(row)};}
  async function imageKey(file){const hash=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return file.name+':'+file.type+':'+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('');}
  async function imageKeys(row){const result={};for(const [,target]of models){const key=target+'-screenshot-file-input';result[key]=await Promise.all((row.attachments?.[key]||[]).map(imageKey));}return result;}
  function file(image){
    const match=image.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/);
    if(!match)throw Error('共享截图读取失败，请在存题软件中检查“'+image.name+'”');
    const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));
    return new File([bytes],image.name,{type:match[1],lastModified:Date.parse(image.createdAt)||0});
  }
  async function from(result,libraryId){
    const r=result.record,base=result.baseRecord||r;
    const row={id:r.id,name:r.title.trim()||r.prompt.trim().slice(0,36)||'未命名记录',archived:r.archived,values:{},attachments:{},ranks:root.QFRecordLibrary.ranking(r.quality.ranking,r)||{},overwriteMode:r.assistant?.overwriteMode||'none',createdAt:Date.parse(r.createdAt),updatedAt:Date.parse(r.updatedAt),rankingVersion:2};
    row.overwrite=row.overwriteMode==='all';
    if(!Object.keys(row.ranks).length&&r.assistant?.rankingText===r.quality.ranking)row.ranks=structuredClone(r.assistant.ranks||{});
    row.syncRanking=typeof r.assistant?.syncRanking==='boolean'?r.assistant.syncRanking:r.quality.enabled&&root.QFRecordLibrary.completeRanks(row.ranks);
    row.values['question-type-radio']=types[r.type]||'';
    for(const [key,path]of Object.entries(fields))row.values[key]=path.includes('.')?r.quality.rankingExplanation:r[path]||'';
    for(const [source,target]of models){const m=r.models[source];row.values[target+'-markdown-input']=m.response;row.values[target+'-achievement-select']=m.result;row.values[target+'-achievement-note-input']=m.note;if(target.startsWith('arena'))row.values[target+'-name-input']=m.actualName;row.attachments[target+'-screenshot-file-input']=m.screenshots.map(file);}
    row.recordLibrary={format:'open-question-studio',version:4,recordId:r.id,title:r.title,tags:r.tags,archived:r.archived,acceptanceResult:r.acceptanceResult,modelNames:Object.fromEntries(models.map(([source,target])=>[target,r.models[source].actualName])),secondRoundEnabled:r.quality.enabled,rankingText:r.quality.ranking,createdAt:r.createdAt,updatedAt:r.updatedAt,warnings:[],attachments:structuredClone(r.attachments)};
    if(r.quality.ranking.trim()&&!root.QFRecordLibrary.completeRanks(row.ranks))row.recordLibrary.warnings.push('原排序无法唯一对应五个模型，原文已保留，请核对模型名称或手动选择名次。');
    if(r.legacy)row.recordLibrary.legacy=structuredClone(r.legacy);
    row._shared={libraryId,revision:result.revision,baseRecord:structuredClone(base),form:plain(row),images:await imageKeys(row)};
    return row;
  }
  async function image(file){
    if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>20*1024*1024)throw Error('截图仅支持20MB以内的PNG、JPEG、WebP或GIF');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return {id:crypto.randomUUID(),name:file.name,dataUrl:'data:'+file.type+';base64,'+btoa(binary),createdAt:new Date(file.lastModified||Date.now()).toISOString()};
  }
  function ranking(ranks){return models.map(([,key],i)=>({i:i+1,rank:Number(ranks[key])})).filter(v=>Number.isInteger(v.rank)&&v.rank>0&&v.rank<=5).sort((a,b)=>a.rank-b.rank||a.i-b.i).map((v,i,all)=>(i?(all[i-1].rank===v.rank?' = ':' ＞ '):'')+'模型'+v.i).join('');}
  async function changes(row){
    const state=row._shared;if(!state)throw Error('共享记录缺少来源，请重新选择记录');
    const before=state.form,now=plain(row),patch=[];
    const add=(path,after)=>{const parts=path.split('.');let value=state.baseRecord;for(const key of parts)value=value?.[key];patch.push({path:parts,before:value,after});};
    if(now.name!==before.name)add('title',now.name);
    if(now.values['question-type-radio']!==before.values['question-type-radio'])add('type',Object.entries(types).find(([,value])=>value===now.values['question-type-radio'])?.[0]||'');
    for(const [key,path]of Object.entries(fields))if((now.values[key]||'')!==(before.values[key]||''))add(path,now.values[key]||'');
    for(const [source,target]of models){
      for(const [suffix,key]of [['-markdown-input','response'],['-achievement-select','result'],['-achievement-note-input','note'],...(target.startsWith('arena')?[['-name-input','actualName']]:[])])if((now.values[target+suffix]||'')!==(before.values[target+suffix]||''))add('models.'+source+'.'+key,now.values[target+suffix]||'');
    }
    const assistant={...(state.baseRecord.assistant||{})};let assistantChanged=false;
    if(!equal(now.ranks,before.ranks)){add('quality.ranking',ranking(now.ranks));assistant.ranks=now.ranks;assistant.rankingText=ranking(now.ranks);assistantChanged=true;}
    if(now.syncRanking!==before.syncRanking){assistant.syncRanking=now.syncRanking;assistantChanged=true;}
    if(now.overwriteMode!==before.overwriteMode){assistant.overwriteMode=now.overwriteMode;assistantChanged=true;}
    if(assistantChanged)add('assistant',assistant);
    const keys=await imageKeys(row);
    for(const [source,target]of models){const key=target+'-screenshot-file-input';if(!equal(keys[key],state.images[key]))add('models.'+source+'.screenshots',await Promise.all((row.attachments[key]||[]).map(image)));}
    return patch;
  }
  async function create(row){
    const source=row.recordLibrary||{},now=new Date().toISOString();
    const hasSecondRound=models.slice(3).some(([,key])=>Object.entries(row.values||{}).some(([id,value])=>id.startsWith(key+'-')&&String(value||'').trim())||(row.attachments?.[key+'-screenshot-file-input']||[]).length)||Object.values(row.ranks||{}).some(Boolean)||!!row.values?.['ranking-reason-input']?.trim()||!!row.syncRanking;
    const secondRoundEnabled=typeof source.secondRoundEnabled==='boolean'?source.secondRoundEnabled:hasSecondRound;
    const r={id:row.id,title:row.name||'',type:Object.entries(types).find(([,value])=>value===row.values?.['question-type-radio'])?.[0]||'',field:'',tags:String(source.tags||''),prompt:'',insight:'',criteriaText:'',nonDecisiveCriteriaText:'',models:{},quality:{enabled:secondRoundEnabled,ranking:ranking(row.ranks||{})||source.rankingText||'',rankingExplanation:''},attachments:structuredClone(source.attachments||[]),acceptanceResult:['通过','不通过'].includes(source.acceptanceResult)?source.acceptanceResult:'',archived:root.QFDB.isArchived(row),createdAt:new Date(row.createdAt||Date.now()).toISOString(),updatedAt:now,assistant:{overwriteMode:root.QFSchema.overwriteMode(row),syncRanking:!!row.syncRanking}};
    for(const [key,path]of Object.entries(fields)){if(path.includes('.'))r.quality.rankingExplanation=row.values?.[key]||'';else r[path]=row.values?.[key]||'';}
    for(const [key,target,name]of models)r.models[key]={actualName:target.startsWith('arena')?row.values?.[target+'-name-input']||'':source.modelNames?.[target]||name,response:row.values?.[target+'-markdown-input']||'',result:row.values?.[target+'-achievement-select']||'',note:row.values?.[target+'-achievement-note-input']||'',screenshots:await Promise.all((row.attachments?.[target+'-screenshot-file-input']||[]).map(image))};
    if(source.legacy)r.legacy=structuredClone(source.legacy);
    r.assistant.ranks=structuredClone(row.ranks||{});r.assistant.rankingText=r.quality.ranking;
    return r;
  }
  // Rebase changes typed while a save was in flight onto its returned snapshot.
  async function rebase(current,snapshot,saved){
    const a=plain(current),b=plain(snapshot);
    if(a.name!==b.name)saved.name=a.name;
    for(const key of new Set([...Object.keys(a.values),...Object.keys(b.values)]))if(a.values[key]!==b.values[key])saved.values[key]=a.values[key]||'';
    if(!equal(a.ranks,b.ranks))saved.ranks=a.ranks;
    if(a.syncRanking!==b.syncRanking)saved.syncRanking=a.syncRanking;
    if(a.overwriteMode!==b.overwriteMode){saved.overwriteMode=a.overwriteMode;saved.overwrite=a.overwriteMode==='all';}
    const ai=await imageKeys(current),bi=await imageKeys(snapshot);
    for(const key of Object.keys(ai))if(!equal(ai[key],bi[key]))saved.attachments[key]=current.attachments[key];
    return saved;
  }
  root.QFSharedMap={from,changes,create,rebase};
})(globalThis);
