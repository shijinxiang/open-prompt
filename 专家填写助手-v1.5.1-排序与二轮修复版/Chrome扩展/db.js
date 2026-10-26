(function(root){
  let connection=null;
  const isArchived=row=>typeof row?.archived==='boolean'?row.archived:row?.recordLibrary?.archived===true;
  const archiveChannel=typeof root.BroadcastChannel==='function'?new root.BroadcastChannel('quality-fill-archive-v1'):null;
  if(archiveChannel)archiveChannel.onmessage=event=>{if(event.data?.type==='archive-changed')root.dispatchEvent?.(new Event('qf-archive-changed'));};
  function summary(row){
    const fields=root.QFSchema?.fields;
    const fieldCount=fields?fields.filter(f=>f.type==='file'?(row.attachments?.[f.id]||[]).length:!!String(row.values?.[f.id]||'').trim()).length:Object.values(row.values||{}).filter(v=>String(v||'').trim()).length+Object.values(row.attachments||{}).filter(v=>v.length).length;
    return {id:row.id,name:row.name,archived:isArchived(row),createdAt:row.createdAt||row.updatedAt,updatedAt:row.updatedAt,fieldCount};
  }
  function open(){
    if(connection)return connection;
    connection=new Promise((resolve,reject)=>{
      const req=indexedDB.open('quality-fill-local-v1',5);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('drafts'))db.createObjectStore('drafts',{keyPath:'id'});
        if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');
        if(!db.objectStoreNames.contains('summaries'))db.createObjectStore('summaries',{keyPath:'id'});
        const summaries=req.transaction.objectStore('summaries'),cursor=req.transaction.objectStore('drafts').openCursor();
        cursor.onsuccess=()=>{const item=cursor.result;if(item){const row=item.value;let changed=false;if(!row.createdAt){row.createdAt=row.updatedAt||Date.now();changed=true;}if(typeof row.archived!=='boolean'){row.archived=isArchived(row);changed=true;}const mode=root.QFSchema.overwriteMode(row);if(row.overwriteMode!==mode||row.overwrite!==(mode==='all')){row.overwriteMode=mode;row.overwrite=mode==='all';changed=true;}if(changed)item.update(row);summaries.put(summary(row));item.continue();}};
      };
      req.onsuccess=()=>{const db=req.result;db.onversionchange=()=>{db.close();connection=null;};db.onclose=()=>{connection=null;};resolve(db);};
      req.onerror=()=>{connection=null;reject(req.error);};
    });return connection;
  }
  async function run(mode,action,store='drafts'){
    const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction(store,mode),req=action(tx.objectStore(store));
      tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存被中断'));
    });
  }
  async function writeRecord(action,value){
    const db=await open();let failure=null;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['drafts','meta','summaries'],'readwrite'),drafts=tx.objectStore('drafts'),meta=tx.objectStore('meta'),summaries=tx.objectStore('summaries');
      const put=value=>{const row={...value,archived:isArchived(value)};drafts.put(row);summaries.put(summary(row));};
      if(action==='delete'){drafts.delete(value);summaries.delete(value);meta.put(true,'deleted-record:'+value);}
      else if(action==='import')for(const row of value){meta.delete('deleted-record:'+row.id);put(row);}
      else{
        const check=meta.get('deleted-record:'+value.id);
        check.onsuccess=()=>{
          if(check.result){failure=new Error('这条记录已删除，请刷新填写台后选择其他记录');failure.code='QF_RECORD_DELETED';tx.abort();return;}
          const existing=drafts.get(value.id);
          existing.onsuccess=()=>put({...value,archived:isArchived(existing.result||value)});
        };
      }
      tx.oncomplete=()=>{root.dispatchEvent?.(new Event('qf-records-changed'));resolve();};
      tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error('保存被中断'));
    });
  }
  async function putMissing(rows){
    const db=await open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['drafts','meta','summaries'],'readwrite'),drafts=tx.objectStore('drafts'),meta=tx.objectStore('meta'),summaries=tx.objectStore('summaries');
      const result={count:0,skipped:0,activeDraftId:null,importedIds:[]};
      for(const row of rows){
        const check=drafts.get(row.id);
        check.onsuccess=()=>{
          if(check.result){result.skipped++;return;}
          const saved={...row,archived:isArchived(row)};drafts.put(saved);summaries.put(summary(saved));meta.delete('deleted-record:'+row.id);
          result.count++;result.importedIds.push(row.id);result.activeDraftId||=row.id;
        };
      }
      tx.oncomplete=()=>{if(result.count)root.dispatchEvent?.(new Event('qf-records-changed'));result.activeDraftId||=rows[0]?.id||null;resolve(result);};
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('导入被中断，未写入记录'));
    });
  }
  async function setArchived(id,archived){
    if(typeof archived!=='boolean')throw new Error('归档状态无效');
    const db=await open();let row,failure;
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(['drafts','summaries'],'readwrite'),drafts=tx.objectStore('drafts'),summaries=tx.objectStore('summaries'),request=drafts.get(id);
      request.onsuccess=()=>{if(!request.result){failure=new Error('该记录已删除，请刷新列表');tx.abort();return;}row={...request.result,archived,updatedAt:Date.now()};drafts.put(row);summaries.put(summary(row));};
      tx.oncomplete=()=>{root.dispatchEvent?.(new Event('qf-records-changed'));archiveChannel?.postMessage({type:'archive-changed',id,archived});resolve(row);};
      tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error('归档状态未保存'));
    });
  }
  root.QFDB={get:id=>run('readonly',s=>s.get(id)),all:()=>run('readonly',s=>s.getAll()),summaries:()=>run('readonly',s=>s.getAll(),'summaries'),summary,isArchived,setArchived,put:d=>writeRecord('put',d),delete:id=>writeRecord('delete',id),putMany:rows=>writeRecord('import',rows),putMissing,getMeta:key=>run('readonly',s=>s.get(key),'meta'),setMeta:(key,value)=>run('readwrite',s=>s.put(value,key),'meta')};
})(globalThis);
