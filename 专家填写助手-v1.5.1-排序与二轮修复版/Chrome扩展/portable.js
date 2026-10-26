(function(root){
  const $=id=>document.getElementById(id);
  const format='quality-fill-library';
  const filename='portable-records.json';
  const assets=['manifest.json','app.html','app.css','app.js','image-viewer.js','schema.js','db.js','shared-map.js','shared-db.js','shared-library.js','library-import.js','record-library-domain.js','engine.js','tabs.js','question-probe.js','bindings.js','platform-watch.js','background.js','overlay.js','popup.html','popup.css','popup.js','archive.js','portable.js','portable-guide.html','portable-demo.html','icon16.png','icon48.png','icon128.png'];
  let hooks={},directory=null,timer=null,chain=Promise.resolve(),revision=0,seed=null,ready=false;
  const notify=text=>{$('portableNotice').textContent=text;};
  const status=(text,state='')=>{$('portableStatus').textContent=text;$('portableStatus').dataset.state=state;};
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function imageJSON(file){
    const bytes=new Uint8Array(await file.arrayBuffer());let text='';
    for(let i=0;i<bytes.length;i+=16384)text+=String.fromCharCode(...bytes.subarray(i,i+16384));
    return {name:file.name,type:file.type,lastModified:file.lastModified,base64:btoa(text)};
  }
  async function pack(rows,activeDraftId){
    const drafts=[];
    for(const row of rows){
      const values={},attachments={},ranks={};
      for(const field of QFSchema.fields){
        if(field.type==='file')attachments[field.id]=await Promise.all((row.attachments?.[field.id]||[]).map(imageJSON));
        else if(typeof row.values?.[field.id]==='string')values[field.id]=row.values[field.id];
      }
      for(const [model]of QFSchema.models)if(row.ranks?.[model])ranks[model]=String(row.ranks[model]);
      drafts.push({...(row.recordLibrary?{recordLibrary:structuredClone(row.recordLibrary)}:{}),id:row.id,name:row.name,rankingVersion:row.rankingVersion,archived:QFDB.isArchived(row),values,attachments,ranks,overwriteMode:QFSchema.overwriteMode(row),overwrite:QFSchema.overwriteMode(row)==='all',syncRanking:!!row.syncRanking,createdAt:row.createdAt||row.updatedAt,updatedAt:row.updatedAt});
    }
    return {format,version:1,snapshotId:crypto.randomUUID(),exportedAt:new Date().toISOString(),activeDraftId:drafts.some(d=>d.id===activeDraftId)?activeDraftId:drafts[0]?.id||null,drafts};
  }
  async function unpack(data){
    if(data?.format!==format||data.version!==1||!Array.isArray(data.drafts)||typeof data.snapshotId!=='string')throw Error('不是有效的全部记录迁移文件');
    const ids=new Set(),rows=[];
    for(const source of data.drafts){
      if(!source||typeof source.id!=='string'||!source.id||source.id.length>200||ids.has(source.id)||!source.values||typeof source.values!=='object'||Array.isArray(source.values))throw Error('迁移文件的记录格式无效');
      ids.add(source.id);
      if(source.archived!==undefined&&typeof source.archived!=='boolean')throw Error('迁移文件的归档状态无效');
      if(source.overwriteMode!==undefined&&!['none','all','later'].includes(source.overwriteMode))throw Error('迁移文件的覆盖模式无效');
      const row={id:source.id,name:String(source.name||'导入记录'),values:{},attachments:{},ranks:{},overwrite:!!source.overwrite,syncRanking:!!source.syncRanking,createdAt:Number(source.createdAt)||Date.now(),updatedAt:Number(source.updatedAt)||Date.now()};
      for(const field of QFSchema.fields){
        if(field.type!=='file'){if(typeof source.values[field.id]==='string')row.values[field.id]=source.values[field.id];continue;}
        const images=source.attachments?.[field.id]||[];if(!Array.isArray(images))throw Error('迁移文件的图片列表无效');
        row.attachments[field.id]=[];
        for(const image of images){
          if(typeof image?.base64!=='string'||image.base64.length>29*1024*1024||!String(image.type).startsWith('image/'))throw Error('迁移文件含无效或过大的图片');
          const binary=atob(image.base64);if(binary.length>20*1024*1024)throw Error('迁移文件中单张图片超过20MB');
          const bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
          row.attachments[field.id].push(new File([bytes],String(image.name||'image.png'),{type:image.type,lastModified:Number(image.lastModified)||Date.now()}));
        }
      }
      for(const [model]of QFSchema.models)if(source.ranks?.[model])row.ranks[model]=String(source.ranks[model]);
      if(source.recordLibrary&&typeof source.recordLibrary==='object'&&!Array.isArray(source.recordLibrary))row.recordLibrary=structuredClone(source.recordLibrary);
      if(source.rankingVersion===2)row.rankingVersion=2;
      row.archived=QFDB.isArchived(source);
      row.overwriteMode=QFSchema.overwriteMode(source);row.overwrite=row.overwriteMode==='all';
      rows.push(row);
    }
    return rows;
  }
  async function snapshot(){return pack(await QFDB.all(),await hooks.getActiveId?.());}
  async function importLibrary(data,merge=true){
    // Parse every record and image before the single atomic database write.
    const rows=await unpack(data);if(await root.QFShared?.enabled())for(const row of rows)row.id=root.QFShared.normalizeId(row);
    const existing=await QFDB.summaries(),ids=new Set(existing.map(d=>d.id));
    if(!merge&&existing.length)throw Error('当前已有记录，请使用合并导入');
    const sourceActive=data.activeDraftId;
    let active=null;
    for(const row of rows){
      const original=row.id;
      if(ids.has(row.id)){row.id=crypto.randomUUID();row.name+='（导入）';}
      ids.add(row.id);if(original===sourceActive)active=row.id;
    }
    if(rows.length){await QFDB.putMany(rows);active||=rows[0].id;await hooks.setActiveId?.(active);}
    await QFDB.setMeta('portable-applied-seed',data.snapshotId);
    return {count:rows.length,activeDraftId:active};
  }
  async function restoreSeed(){
    const response=await fetch(filename,{cache:'no-store'});
    if(!response.ok)throw Error('无法读取文件夹中的迁移记录');
    const data=await response.json();
    if(data?.format!==format||!Array.isArray(data.drafts))throw Error('文件夹中的迁移记录格式无效');
    if(!data.drafts.length||await QFDB.getMeta('portable-applied-seed')===data.snapshotId)return null;
    if((await QFDB.summaries()).length){seed=data;$('importFolderRecords').hidden=false;notify('文件夹中带有 '+data.drafts.length+' 条记录，可点击“导入文件夹记录”合并恢复。');return null;}
    const result=await importLibrary(data,false);notify('已从文件夹恢复 '+result.count+' 条记录和图片。请在这台电脑重新选择目标网页。');return result;
  }
  async function permission(request=false){
    if(!directory)return false;
    let state=await directory.queryPermission({mode:'readwrite'});
    if(state!=='granted'&&request)state=await directory.requestPermission({mode:'readwrite'});
    return state==='granted';
  }
  function schedule(){
    revision++;if(!ready||!directory)return;
    clearTimeout(timer);status('有新修改，正在等待写入随身文件夹…','pending');
    timer=setTimeout(()=>syncFolder().catch(e=>status('未同步：'+e.message,'error')),1200);
  }
  async function syncFolder(){
    clearTimeout(timer);
    const work=async()=>{
      if(!directory)throw Error('请先连接原安装文件夹');
      if(!await permission()){status('文件夹需要重新授权，请点击“立即同步 / 继续同步”。','pending');return false;}
      const version=revision;status('正在写入全部记录和图片…','pending');
      const data=await snapshot();const file=await directory.getFileHandle(filename,{create:true});
      const writer=await file.createWritable();
      try{await writer.write(new Blob([JSON.stringify(data)],{type:'application/json'}));await writer.close();}
      catch(e){try{await writer.abort();}catch{}throw e;}
      await QFDB.setMeta('portable-applied-seed',data.snapshotId);
      status(version===revision?'已同步到 '+directory.name+' · '+data.drafts.length+' 条记录 · '+new Date().toLocaleTimeString('zh-CN',{hour12:false}):'还有新修改，正在等待下一次同步…',version===revision?'saved':'pending');
      return true;
    };
    const operation=chain.catch(()=>{}).then(()=>root.navigator?.locks?root.navigator.locks.request('quality-fill-portable-folder',work):work());chain=operation;return operation;
  }
  async function validateDirectory(chosen){
    let dir=chosen;
    try{await dir.getFileHandle('manifest.json');}catch{dir=await chosen.getDirectoryHandle('Chrome扩展');}
    const file=await (await dir.getFileHandle('manifest.json')).getFile();
    const manifest=JSON.parse(await file.text());
    if(!['专家填写助手','质检填写助手'].includes(manifest.name))throw Error('请选择本工具的原安装文件夹，或里面的“Chrome扩展”文件夹');
    return dir;
  }
  async function connect(){
    if(!root.showDirectoryPicker){notify('此窗口不支持连接文件夹，请打开完整填写台；也可以直接导出整套迁移包。');return;}
    try{
      const chosen=await root.showDirectoryPicker({mode:'readwrite',id:'quality-fill-portable'});
      const next=await validateDirectory(chosen);await hooks.beforeSave?.();
      await QFDB.setMeta('portable-directory',next);directory=next;$('syncFolder').disabled=false;
      await syncFolder();notify('文件夹已连接。后续修改会自动同步；打包前请点“立即同步”，等提示已同步后再复制整个文件夹。');
    }catch(e){if(e.name!=='AbortError')notify('连接未完成：'+e.message+'。可改用“导出整套迁移包”。');}
  }
  async function exportZip(){
    $('exportPortable').disabled=true;
    try{
      await hooks.beforeSave?.();notify('正在打包程序、全部记录和图片，请稍候…');
      const data=await snapshot(),files=[];
      for(const path of assets){
        const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw Error('缺少程序文件 '+path+'，请完整解压新版再使用');
        files.push({name:'专家填写助手/Chrome扩展/'+path,blob:await response.blob()});
      }
      const guide=files.find(f=>f.name.endsWith('/portable-guide.html')).blob;
      files.push({name:'专家填写助手/先看这里-安装使用.html',blob:guide},{name:'专家填写助手/Chrome扩展/'+filename,blob:new Blob([JSON.stringify(data)],{type:'application/json'})});
      const demo=await files.find(f=>f.name.endsWith('/portable-demo.html')).blob.text();
      files.push({name:'专家填写助手/演示网页.html',blob:new Blob([demo.replace('src="schema.js"','src="Chrome扩展/schema.js"').replace('href="portable-guide.html"','href="先看这里-安装使用.html"')],{type:'text/html;charset=utf-8'})},{name:'专家填写助手/使用说明.txt',blob:new Blob(['打开“先看这里-安装使用.html”查看安装及迁移说明。新电脑加载“Chrome扩展”并打开填写台，会恢复包内全部记录和截图。后续修改需重新导出迁移包，或连接随身文件夹同步。'],{type:'text/plain;charset=utf-8'})});
      const zip=await QFArchive.zip(files);download(zip,'专家填写助手-随身迁移包-'+new Date().toISOString().slice(0,10)+'.zip');
      notify('已生成包含 '+data.drafts.length+' 条记录及图片的完整迁移包。新电脑解压并加载里面的“Chrome扩展”，打开填写台即可恢复。');
    }catch(e){notify('迁移包未生成：'+e.message);}
    finally{$('exportPortable').disabled=false;}
  }
  async function init(callbacks){
    hooks=callbacks;
    $('exportPortable').onclick=exportZip;$('connectFolder').onclick=connect;
    $('syncFolder').onclick=async()=>{
      try{if(!await permission(true)){notify('尚未获得文件夹写入权限。请重新连接文件夹，或导出迁移包。');return;}await hooks.beforeSave?.();await syncFolder();}
      catch(e){status('未同步：'+e.message,'error');}
    };
    $('importFolderRecords').onclick=async()=>{
      if(!seed)return;$('importFolderRecords').disabled=true;
      try{await hooks.beforeSave?.();hooks.beginRestore?.();const result=await importLibrary(seed,true);seed=null;$('importFolderRecords').hidden=true;await hooks.afterRestore?.(result);notify('已合并恢复 '+result.count+' 条记录和图片，原记录保留。');}
      catch(e){notify('未恢复记录：'+e.message);}finally{hooks.endRestore?.();$('importFolderRecords').disabled=false;}
    };
    let restored=null;
    try{restored=await restoreSeed();}catch(e){notify('未自动恢复文件夹记录：'+e.message+'。原有本机记录未改动。');}
    try{
      directory=await QFDB.getMeta('portable-directory');
      if(directory){$('syncFolder').disabled=false;status(await permission()?'已连接 '+directory.name+'，后续修改自动同步。':'已记住文件夹，点击“立即同步 / 继续同步”重新授权。');}
    }catch{directory=null;}
    ready=true;return restored;
  }
  root.addEventListener?.('qf-records-changed',schedule);
  root.QFPortable={init,pack,unpack,importLibrary,syncFolder,schedule,exportZip,assets};
})(globalThis);
