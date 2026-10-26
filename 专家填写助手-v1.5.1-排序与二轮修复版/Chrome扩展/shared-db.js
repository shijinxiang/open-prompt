/* Shared mode has one authoritative database, served by the desktop on loopback. */
(function(root){
  const local=root.QFDB,cache=new Map();let lastRevision='',failure='',recoveryQueue=Promise.resolve();
  async function config(){if(root.chrome?.runtime?.id)return (await chrome.storage.local.get('sharedLibrary')).sharedLibrary;try{return JSON.parse(localStorage.getItem('qf_sharedLibrary')||'null');}catch{return null;}}
  async function setConfig(value){cache.clear();lastRevision='';if(root.chrome?.runtime?.id)await chrome.storage.local.set({sharedLibrary:value});else localStorage.setItem('qf_sharedLibrary',JSON.stringify(value));}
  async function enabled(){return !!(await config())?.enabled;}
  function remember(row){
    const snapshot=structuredClone(row),saveId=crypto.randomUUID();
    const operation=recoveryQueue.catch(()=>{}).then(async()=>{const c=await config();if(!c?.enabled&&!snapshot._shared)return null;const key='shared-pending:'+(snapshot._shared?.libraryId||c.libraryId)+':'+snapshot.id;await local.setMeta(key,{saveId,row:snapshot});return {key,saveId};});
    recoveryQueue=operation;return operation;
  }
  function clearRecovery(saved){const operation=recoveryQueue.catch(()=>{}).then(async()=>{if(saved&&(await local.getMeta(saved.key))?.saveId===saved.saveId)await local.setMeta(saved.key,null);});recoveryQueue=operation;return operation;}
  async function request(route,method='GET',data,override){
    const c=override||await config();if(!c?.enabled)throw Error('尚未连接共享题库');
    if(!Number.isInteger(c.port)||c.port<1||c.port>65535||!/^\w[\w-]{11,99}$/.test(c.libraryId)||!(/^[a-f0-9]{64}$/).test(c.token))throw Error('连接设置无效，请重新复制连接码');
    let response;try{response=await fetch('http://127.0.0.1:'+c.port+'/v1/'+route,{method,headers:{Authorization:'Bearer '+c.token,...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{}),signal:AbortSignal.timeout(20000)});}catch{failure='共享题库未连接，请保持存题软件运行';throw Error(failure);}
    const result=await response.json();if(!response.ok){const error=Error(result.error||'共享题库操作失败');error.code=result.code;error.status=response.status;error.conflicts=result.conflicts;throw error;}
    failure='';return result;
  }
  async function check(){const c=await config(),info=await request('info');if(info.libraryId!==c.libraryId)throw Error('当前存题软件使用了另一份数据库，请重新配对');return c;}
  function normalizeId(row){return row.id==='oqs-'+row.recordLibrary?.recordId?row.recordLibrary.recordId:row.id;}
  async function canonicalId(id){if(cache.has(id))return id;if(id.startsWith('oqs-')){try{await request('records/'+id);return id;}catch(e){if(e.status!==404)throw e;}return id.slice(4);}return id;}
  async function get(id){
    await check();id=await canonicalId(id);
    let result;try{result=await request('records/'+id);}catch(e){if(e.status===404)return null;throw e;}
    const cached=cache.get(id);if(cached?._shared.revision===result.revision)return structuredClone(cached);
    const full=await request('records/'+id+'?images=1'),row=await root.QFSharedMap.from(full,(await config()).libraryId);cache.set(id,row);return structuredClone(row);
  }
  async function summaries(){await check();const result=await request('records');lastRevision=result.revision;return result.records.map(row=>({...row,name:row.title,createdAt:Date.parse(row.createdAt),updatedAt:Date.parse(row.updatedAt)}));}
  async function put(row){
    const c=await config();
    const recovery=await remember(row);
    try{
      await check();
      if(row._shared){if(row._shared.libraryId!==c.libraryId)throw Error('记录来自另一份共享题库，请重新选择');const changes=await root.QFSharedMap.changes(row);if(changes.length)await request('records/'+row.id+'/patch','POST',{changes});}
      else {await request('import','POST',{records:[await root.QFSharedMap.create(row)]});}
      cache.delete(row.id);const saved=await get(row.id);if(!saved){const e=Error('这条记录已删除，请切换记录');e.code='QF_RECORD_DELETED';throw e;}
      await clearRecovery(recovery);root.dispatchEvent?.(new Event('qf-records-changed'));return {row:saved};
    }catch(error){if(error.status===404)error.code='QF_RECORD_DELETED';throw error;}
  }
  async function importRows(rows){await check();const records=[];for(const original of rows){const row={...original,id:normalizeId(original)};records.push(await root.QFSharedMap.create(row));}const result=await request('import','POST',{records});cache.clear();root.dispatchEvent?.(new Event('qf-records-changed'));return {...result,activeDraftId:result.importedIds[0]||records[0]?.id||null};}
  const proxy={...local};
  for(const [name,shared]of Object.entries({get,summaries,all:async()=>{const list=await summaries(),rows=[];for(const row of list)rows.push(await get(row.id));return rows.filter(Boolean);},put,putMany:importRows,putMissing:importRows,setArchived:async(id,archived)=>{await check();id=await canonicalId(id);await request('records/'+id+'/archive','POST',{archived});cache.delete(id);root.dispatchEvent?.(new Event('qf-archive-changed'));return get(id);},delete:async id=>{await check();id=await canonicalId(id);const latest=await request('records/'+id);await request('records/'+id+'/delete','POST',{revision:latest.revision});cache.delete(id);}}))proxy[name]=async(...args)=>(await enabled()?shared:local[name])(...args);
  root.QFDB=proxy;
  proxy.put=async row=>{if(await enabled())return put(row);if(row._shared){await remember(row);throw Error('题库模式已切换，请刷新填写台后继续');}return local.put(row);};
  root.QFShared={enabled,remember,config,setConfig,check,local,normalizeId,get revision(){return lastRevision;},get failure(){return failure;},async applyResolved(id,changes){await check();if(changes.length)await request('records/'+id+'/patch','POST',{changes});cache.delete(id);},async pending(id){const c=await config();const value=await local.getMeta('shared-pending:'+c.libraryId+':'+id);return value?.row||value;},async discardPending(id){const c=await config();return local.setMeta('shared-pending:'+c.libraryId+':'+id,null);},async importBackup(data){await check();const {upgradeBackup}=await import('./record-library-domain.js');const result=await request('import','POST',{records:upgradeBackup(data).records});cache.clear();return {...result,activeDraftId:result.importedIds[0]||data.records[0]?.id||null,warnings:0};},async connect(code){const parts=String(code).trim().match(/^oqs-shared:v1:(\d{1,5}):([\w-]{12,100}):([a-f0-9]{64})$/);if(!parts)throw Error('请粘贴存题软件“设置”中复制的完整连接码');const c={enabled:true,port:Number(parts[1]),libraryId:parts[2],token:parts[3]};const info=await request('info','GET',null,c);if(info.libraryId!==c.libraryId)throw Error('连接码与题库不匹配');await setConfig(c);}};
})(globalThis);
