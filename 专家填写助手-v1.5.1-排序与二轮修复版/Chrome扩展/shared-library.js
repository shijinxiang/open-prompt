(function(){
  const card=document.createElement('section');card.className='shared-card';
  card.innerHTML='<div class="portable-heading"><div><h2>与存题软件共用题库</h2><p>同一份题目、截图和归档状态，只需在任意一边归档一次。</p></div><span id="sharedMode">独立本机模式</span></div><div class="shared-connect"><input id="sharedCode" type="password" autocomplete="off" aria-label="存题软件连接码" placeholder="粘贴存题软件“设置”中的连接码"><button id="sharedConnect">连接共享题库</button><button id="sharedDisconnect" hidden>切回独立本机</button></div><p id="sharedStatus" role="status">首次连接：打开新版存题软件 → 设置 → 复制插件连接码。</p><button id="sharedMigrate" hidden>将插件原有本机记录加入共享题库</button><div id="sharedConflict" hidden><p>同一字段已在另一边修改。你的修改已暂存，请选择处理方式。</p><button id="sharedUseLocal">保留我的冲突字段</button><button id="sharedUseRemote">采用题库中的冲突字段</button></div>';
  document.querySelector('.draft-bar').before(card);
  let polling=false,revision='',conflict=false;
  async function mode(){const enabled=await QFShared.enabled();$('sharedMode').textContent=enabled?'共享题库模式':'独立本机模式';$('sharedDisconnect').hidden=!enabled;$('sharedMigrate').hidden=!enabled;$('sharedConnect').textContent=enabled?'重新连接':'连接共享题库';if(enabled)$('sharedStatus').textContent='正在连接共享题库…';return enabled;}
  $('sharedConnect').onclick=async()=>{if(busy||switching)return;switching=true;clearTimeout(saveTimer);try{if(draft){try{await saveNow();}catch(e){if(!await QFShared.enabled())throw e;}}await QFShared.connect($('sharedCode').value);$('sharedCode').value='';draft=null;location.reload();}catch(e){switching=false;syncQuickState();$('sharedStatus').textContent=e.message;}};
  $('sharedDisconnect').onclick=async()=>{if(busy||switching)return;switching=true;clearTimeout(saveTimer);try{if(draft)await saveNow();}catch{}draft=null;await QFShared.setConfig({enabled:false});location.reload();};
  $('sharedMigrate').onclick=async()=>{try{if(draft)await saveNow();const rows=await QFShared.local.all();const result=await QFDB.putMissing(rows);await draftList();toast('已加入 '+result.count+' 条，跳过 '+result.skipped+' 条已有记录。');}catch(e){toast(e.message);}};
  function failed(error){if(error.code==='SHARED_CONFLICT'){conflict=true;$('sharedConflict').hidden=false;$('sharedStatus').textContent='共享字段冲突，未覆盖题库；请选择保留方式。';}}
  async function resolve(preferLocal){
    if(!draft||busy||switching)return;switching=true;syncQuickState();
    try{
      const current=structuredClone(draft),latest=await QFDB.get(draft.id);if(!latest)throw Error('这条记录已删除，请先导出当前备份');
      const changes=await QFSharedMap.changes(current);
      // Apply only local edited fields; leave all unrelated remote edits intact.
      const conflicts=[];for(const change of changes){let value=latest._shared.baseRecord;for(const key of change.path)value=value?.[key];if(JSON.stringify(value)!==JSON.stringify(change.before)&&JSON.stringify(value)!==JSON.stringify(change.after))conflicts.push(change.path.join('.'));}
      const keep=preferLocal?changes:changes.filter(change=>!conflicts.includes(change.path.join('.')));
      // Use an explicit patch based on the latest snapshot, then fetch File images normally.
      await QFShared.applyResolved(draft.id,keep.map(change=>{let value=latest._shared.baseRecord;for(const key of change.path)value=value?.[key];return {...change,before:value};}));
      adoptDraft(await QFDB.get(draft.id));await QFShared.discardPending(draft.id);conflict=false;$('sharedConflict').hidden=true;render();await draftList();toast('冲突已处理');
    }catch(e){toast('处理失败：'+e.message);}finally{switching=false;syncQuickState();}
  }
  $('sharedUseLocal').onclick=()=>resolve(true);$('sharedUseRemote').onclick=()=>resolve(false);
  async function poll(){
    if(polling||document.hidden||busy||switching||!await QFShared.enabled())return;
    polling=true;try{
      const list=await QFDB.summaries(),changed=revision!==QFShared.revision;revision=QFShared.revision;
      $('sharedStatus').textContent='已连接存题软件 · '+list.length+' 条记录 · 归档与修改自动同步';
      if(!draft){location.reload();return;}
      if(changed&&draft&&!conflict){
        const state=draftState();if(state.revision>state.saved)await saveNow();
        else {const current=await QFDB.get(draft.id);if(current&&current._shared.revision!==draft._shared?.revision){adoptDraft(current);render();}else if(!current){const next=list.find(row=>!row.archived)||list[0];adoptDraft(next?await QFDB.get(next.id):blank(),!!next);render();}}
        records=list;refreshRecordOptions();renderRecordList();await refreshTabs();
      }
    }catch(e){$('sharedStatus').textContent=e.message;failed(e);}finally{polling=false;}
  }
  mode().then(()=>{setInterval(poll,1200);window.addEventListener('focus',poll);}).catch(e=>{$('sharedStatus').textContent=e.message;});
  async function changedMode(){switching=true;clearTimeout(saveTimer);if(draft?._shared&&draftState().revision>draftState().saved)await QFShared.remember(draft);draft=null;location.reload();}
  if(extension)chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.sharedLibrary)changedMode().catch(e=>toast(e.message));});
  else window.addEventListener('storage',event=>{if(event.key==='qf_sharedLibrary')changedMode().catch(e=>toast(e.message));});
  globalThis.QFSharedUI={failed,poll};
})();
