/* Adapter for the Open Question Studio JSON backup. No network or platform writes. */
(function(root){
  const models=[['doubao','doubao'],['gpt','gpt56'],['opus','claude'],['model4','arena1'],['model5','arena2']];
  const types={'开放推荐类':'openRecommendation','分析决策类':'analysisDecision','How-to 类':'howTo'};
  const isBackup=data=>!!data&&Array.isArray(data.records)&&!data.format;
  const normalized=value=>String(value||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
  function ranking(text,names={}){
    const aliases=new Map(),add=(name,index)=>{const key=normalized(name);if(!key)return;if(!aliases.has(key))aliases.set(key,new Set());aliases.get(key).add(index);};
    for(const [index,[source,target]]of models.entries()){
      add('模型'+(index+1),index);
      add(names.models?.[source]?.actualName||names[target]||names[source],index);
    }
    const tokens=normalized(text).split(/([>=])/),seen=new Set(),ranks={};let rank=1;
    if(tokens.length!==9)return null;
    for(let i=0;i<tokens.length;i+=2){
      if(i&&tokens[i-1]==='>')rank++;
      const candidates=aliases.get(tokens[i]);if(candidates?.size!==1)return null;
      const index=[...candidates][0];if(seen.has(index))return null;
      seen.add(index);ranks[models[index][1]]=String(rank);
    }
    return seen.size===5?ranks:null;
  }
  function completeRanks(ranks){return models.every(([,key])=>/^[1-5]$/.test(String(ranks?.[key]||'')));}
  function repairRanking(row){
    if(!row||row.rankingVersion===2||!row.recordLibrary)return false;
    const source=row.recordLibrary,parsed=ranking(source.rankingText,source.modelNames||{});
    let changed=false;
    // Repair only the old adapter's empty result; keep manual full/partial ranks.
    if(parsed&&!Object.values(row.ranks||{}).some(value=>String(value||'').trim())){
      row.ranks=parsed;changed=true;
      if(source.secondRoundEnabled)row.syncRanking=true;
      if(row._shared&&!Object.values(row._shared.form.ranks||{}).some(Boolean))row._shared.form.ranks=structuredClone(parsed);
    }
    row.rankingVersion=2;
    return changed;
  }
  function imagesIn(record){
    const images=[...(record.attachments||[]),...Object.values(record.models||{}).flatMap(model=>model.screenshots||[])];
    for(const revision of record.revisions||[])images.push(...Object.values(revision.modelResults||{}).flatMap(model=>model.screenshots||[]));
    if(record.legacy)images.push(...imagesIn(record.legacy));
    return images;
  }
  function screenshot(image,time){
    const match=image.dataUrl?.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\r\n]+)$/);
    if(!match)throw Error('截图“'+image.name+'”缺少内嵌图片。请从记录库点击“导出备份”，不要直接选择 data/records.json。');
    let binary;try{binary=atob(match[2]);}catch{throw Error('截图“'+image.name+'”的图片编码无效。');}
    if(binary.length>20*1024*1024)throw Error('截图“'+image.name+'”超过20MB。');
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    const modified=Date.parse(image.createdAt);
    return new File([bytes],image.name,{type:match[1],lastModified:Number.isNaN(modified)?time:modified});
  }
  async function convert(data,onProgress){
    if(!isBackup(data))throw Error('请选择开放题记录库导出的 JSON 备份。');
    // This module is copied from the record library by the packaging script.
    const {upgradeBackup,displayTitle}=await import('./record-library-domain.js');
    const backup=upgradeBackup(data),rows=[];
    for(const [index,record]of backup.records.entries()){
      const name=displayTitle(record),warnings=[];
      // Check hidden attachments and historical images too, so an incomplete raw
      // records.json cannot silently turn into a supposedly complete backup.
      for(const image of imagesIn(record)){
        if(!image.dataUrl)throw Error('“'+name+'”的截图缺少内嵌图片。请从记录库点击“导出备份”，不要直接选择 data/records.json。');
      }
      const row={id:'oqs-'+record.id,name,archived:record.archived,values:{
        'question-type-radio':types[record.type]||'',
        'question-domain-select':record.field,
        'question-input':record.prompt,
        'insight-input':record.insight,
        'insight-description-input':record.criteriaText,
        'non-decisive-insight-description-input':record.nonDecisiveCriteriaText,
        'ranking-reason-input':record.quality.rankingExplanation,
      },attachments:{},ranks:{},overwrite:false,syncRanking:false,createdAt:Date.parse(record.createdAt),updatedAt:Date.parse(record.updatedAt)};
      const modelNames={};
      for(const [source,target]of models){
        const model=record.models[source];modelNames[target]=model.actualName;
        row.values[target+'-markdown-input']=model.response;
        row.values[target+'-achievement-select']=model.result;
        row.values[target+'-achievement-note-input']=model.note;
        row.attachments[target+'-screenshot-file-input']=model.screenshots.map(image=>screenshot(image,row.updatedAt));
        if(target.startsWith('arena'))row.values[target+'-name-input']=model.actualName;
      }
      const ranks=ranking(record.quality.ranking,record);
      if(ranks){row.ranks=ranks;row.syncRanking=typeof record.assistant?.syncRanking==='boolean'?record.assistant.syncRanking:record.quality.enabled;}
      else if(record.quality.ranking.trim())warnings.push('原排序无法唯一对应五个模型，已保留原文，请核对模型名称或手动选择名次。');
      row.rankingVersion=2;
      if(ranks&&!record.quality.enabled&&!row.syncRanking)warnings.push('记录库的二轮资料已关闭，名次已保留，未启用同步排序。');
      for(const field of root.QFSchema?.fields||[]){
        if(field.max&&String(row.values[field.id]||'').length>field.max)warnings.push(field.label+'超过网页'+field.max+'字符限制，已完整保留，请在填写前调整。');
      }
      row.recordLibrary={format:'open-question-studio',version:data.version,recordId:record.id,title:record.title,tags:record.tags,archived:record.archived,acceptanceResult:record.acceptanceResult,modelNames,secondRoundEnabled:record.quality.enabled,rankingText:record.quality.ranking,createdAt:record.createdAt,updatedAt:record.updatedAt,warnings,attachments:structuredClone(record.attachments)};
      if(record.legacy)row.recordLibrary.legacy=structuredClone(record.legacy);
      rows.push(row);
      onProgress?.(index+1,backup.records.length);
      // Let progress paint between records with many embedded screenshots.
      if(index%4===3)await new Promise(resolve=>setTimeout(resolve,0));
    }
    return rows;
  }
  async function importBackup(data,onProgress){
    if(await root.QFShared?.enabled())return root.QFShared.importBackup(data);
    const rows=await convert(data,onProgress);
    // Conversion must finish for the entire file before any imported row is saved.
    const result=await root.QFDB.putMissing(rows),imported=new Set(result.importedIds);
    return {...result,warnings:rows.reduce((count,row)=>count+(imported.has(row.id)?row.recordLibrary.warnings.length:0),0)};
  }
  root.QFRecordLibrary={isBackup,convert,importBackup,ranking,completeRanks,repairRanking};
})(globalThis);
