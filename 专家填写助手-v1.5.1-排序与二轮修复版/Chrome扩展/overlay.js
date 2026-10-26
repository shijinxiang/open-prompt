(function(){
  if(globalThis.__qualityFillPanelOpen){document.getElementById('__quality_fill_widget_v1')?.remove();return;}
  if(document.getElementById('__quality_fill_widget_v1'))return;
  const host=document.createElement('div');host.id='__quality_fill_widget_v1';
  host.style.cssText='all:initial!important;position:fixed!important;right:20px!important;bottom:20px!important;z-index:2147483647!important;display:block!important;';
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>:host{font:13px "Microsoft YaHei",sans-serif;color:#24344b}*{box-sizing:border-box}section{width:270px;background:#fff;border:1px solid #dbe3ef;border-radius:14px;box-shadow:0 12px 44px #1c31522b;padding:14px}header{display:flex;align-items:center;justify-content:space-between;font-weight:700;margin-bottom:10px}button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:9px 12px;background:#eef3fa;color:#304763}button:disabled{opacity:.6;cursor:wait}.main{background:#2563eb;color:#fff;width:100%;font-weight:700}.muted{font-size:12px;line-height:1.65;color:#61738a;margin:10px 0 0;overflow-wrap:anywhere}.tools{display:flex;gap:8px;margin-top:10px}.tools button{flex:1;padding:6px;font-size:12px}.close{padding:0 4px;background:none}.mini{border:1px solid #dbe3ef;box-shadow:0 5px 20px #1c31522b;background:#2563eb;color:#fff;border-radius:30px;padding:12px 18px}.hidden{display:none}</style><section><header><span>专家填写助手</span><button class="close" aria-label="收起">−</button></header><button class="main">一键补填</button><p class="muted" role="status">解锁新字段后，再点一次补填。</p><div class="tools"><button class="edit">打开填写台</button><button class="hide">隐藏悬浮条</button></div></section><button class="mini hidden">专家补填</button>`;
  (document.body||document.documentElement).append(host);
  const main=shadow.querySelector('.main'),status=shadow.querySelector('[role="status"]');
  const context=document.createElement('p');context.className='muted';context.style.margin='0 0 10px';
  context.textContent='使用当前题号已绑定的记录';main.before(context);
  let currentQuestion=null;
  const modeName=mode=>mode==='all'?'覆盖全部':mode==='later'?'覆盖后半部分':'不覆盖已有内容';
  async function refreshContext(){
    try{
      const response=await chrome.runtime.sendMessage({type:'qf-tab-context'});if(!response.ok)return;
      const value=response.result;
      if(!value.questionId){context.textContent='当前题号已提交、已归档或不可用，请刷新题号。';main.disabled=true;return;}
      main.disabled=false;main.textContent='一键补填';
      context.textContent=value.questionId+' · '+(value.draftName||'尚未选择记录')+' · '+modeName(value.overwriteMode);
      if(currentQuestion&&currentQuestion!==value.questionId)status.textContent='已随题号切换绑定记录。解锁新字段后可继续补填。';
      currentQuestion=value.questionId;
    }catch{}
  }
  function show(report){
    context.textContent='上次：'+report.draftName+' → '+report.tabTitle+' · '+modeName(report.overwriteMode);
    if(report.reset){status.textContent='本记录在当前题目的补填记录已清除。';return;}
    const c=report.counts;status.textContent=`本次写入 ${c.filled} · 已完成 ${c.done+c.same} · 待解锁 ${c.pending} · 保留已有 ${c.occupied} · 失败 ${c.error}${c.upload?' · 已交上传 '+c.upload:''}。`+(report.includeImages===false?'本次忽略图片。':'')+(c.pending?'解锁后可再次点击。':'请在原网页核对并暂存。');
  }
  main.onclick=async()=>{
    main.disabled=true;status.textContent='正在匹配并补填，请保持当前题目…';
    try{const response=await chrome.runtime.sendMessage({type:'qf-fill'});if(!response.ok)throw Error(response.error);show(response.result);}
    catch(e){status.textContent=e.message.includes('context invalidated')?'扩展已更新，请刷新此网页后重新连接。':e.message;}
    finally{await refreshContext();}
  };
  shadow.querySelector('.edit').onclick=()=>chrome.runtime.sendMessage({type:'qf-editor'});
  shadow.querySelector('.close').onclick=()=>{shadow.querySelector('section').classList.add('hidden');shadow.querySelector('.mini').classList.remove('hidden');};
  shadow.querySelector('.mini').onclick=()=>{shadow.querySelector('section').classList.remove('hidden');shadow.querySelector('.mini').classList.add('hidden');};
  shadow.querySelector('.hide').onclick=()=>host.remove();
  chrome.runtime.onMessage.addListener(message=>{if(!host.isConnected)return;if(message.type==='qf-report')show(message.report);if(message.type==='qf-context-changed')refreshContext();});
  refreshContext();
})();
