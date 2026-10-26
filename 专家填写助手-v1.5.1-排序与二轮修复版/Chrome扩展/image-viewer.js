(function(root){
  const $=id=>document.getElementById(id),dialog=$('imageViewer'),stage=$('imageViewerStage'),img=$('imageViewerImage');
  let files=[],index=0,url=null,ticket=0,width=0,height=0,scale=1,x=0,y=0,mode='fit',drag=null,lockedScroll=null;
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  const fitScale=()=>Math.min(1,Math.max(1,stage.clientWidth-32)/width,Math.max(1,stage.clientHeight-32)/height);
  function releaseImage(){
    ticket++;img.removeAttribute('src');if(url){URL.revokeObjectURL(url);url=null;}
    width=height=0;drag=null;stage.classList.remove('dragging','can-drag');
  }
  function paint(){
    if(!width||!height)return;
    const maxX=width*scale>stage.clientWidth?(width*scale-stage.clientWidth)/2+16:0,maxY=height*scale>stage.clientHeight?(height*scale-stage.clientHeight)/2+16:0;
    x=clamp(x,-maxX,maxX);y=clamp(y,-maxY,maxY);
    img.style.width=width+'px';img.style.height=height+'px';
    img.style.transform=`translate(-50%,-50%) translate(${x}px,${y}px) scale(${scale})`;
    $('imageViewerZoom').textContent=Math.round(scale*100)+'%';
    $('imageViewerZoomOut').disabled=scale<=Math.min(.05,fitScale())+.00001;
    $('imageViewerZoomIn').disabled=scale>=8;
    stage.classList.toggle('can-drag',maxX>0||maxY>0);
  }
  function fit(){if(!width)return;mode='fit';scale=fitScale();x=y=0;paint();}
  function zoom(value,anchorX=0,anchorY=0){
    if(!width)return;mode='manual';const next=clamp(value,Math.min(.05,fitScale()),8),ratio=next/scale;
    x=anchorX-(anchorX-x)*ratio;y=anchorY-(anchorY-y)*ratio;scale=next;paint();
  }
  function original(){if(!width)return;mode='manual';scale=1;x=y=0;paint();}
  async function showImage(){
    releaseImage();const current=++ticket,file=files[index];if(!file)return;
    mode='fit';x=y=0;scale=1;
    $('imageViewerName').textContent=file.name;$('imageViewerName').title=file.name;
    $('imageViewerInfo').textContent='正在读取原图…';$('imageViewerPage').textContent=(index+1)+' / '+files.length;
    $('imageViewerPrev').disabled=index===0;$('imageViewerNext').disabled=index===files.length-1;
    for(const id of ['imageViewerZoomOut','imageViewerZoomIn','imageViewerFit','imageViewerOriginal'])$(id).disabled=true;
    $('imageViewerZoom').textContent='—';$('imageViewerMessage').textContent='正在读取原图…';img.hidden=true;
    url=URL.createObjectURL(file);img.src=url;img.alt=file.name;
    try{
      await img.decode();if(current!==ticket||!dialog.open)return;
      width=img.naturalWidth;height=img.naturalHeight;if(!width||!height)throw Error('无效图片');
      $('imageViewerInfo').textContent=width+' × '+height+' 像素 · '+(file.size/1024/1024).toFixed(2)+' MB';
      $('imageViewerMessage').textContent='';img.hidden=false;
      for(const id of ['imageViewerZoomOut','imageViewerZoomIn','imageViewerFit','imageViewerOriginal'])$(id).disabled=false;
      fit();
    }catch{
      if(current!==ticket||!dialog.open)return;
      $('imageViewerInfo').textContent='无法预览';$('imageViewerMessage').textContent='这张图片无法读取，请检查原文件或重新添加。';
    }
  }
  function move(delta){const next=index+delta;if(next<0||next>=files.length)return;index=next;showImage();}
  function unlockPage(){
    const saved=lockedScroll;lockedScroll=null;document.documentElement.classList.remove('image-viewer-open');
    document.documentElement.style.removeProperty('--qf-viewer-scroll-x');document.documentElement.style.removeProperty('--qf-viewer-scroll-y');
    if(saved)window.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});
  }
  function lockPage(){
    lockedScroll={x:window.scrollX,y:window.scrollY};
    document.documentElement.style.setProperty('--qf-viewer-scroll-x',-lockedScroll.x+'px');
    document.documentElement.style.setProperty('--qf-viewer-scroll-y',-lockedScroll.y+'px');
    document.documentElement.classList.add('image-viewer-open');window.scrollTo({left:0,top:0,behavior:'instant'});
  }
  function close(){if(dialog.open)dialog.close();releaseImage();files=[];unlockPage();}
  function open(options){
    const source=Array.from(options.files||[]);if(!source.length)return;
    close();files=source;index=clamp(Math.trunc(Number(options.index)||0),0,files.length-1);
    $('imageViewerContext').textContent=options.title||'回复截图';
    lockPage();dialog.showModal();showImage();
  }
  $('imageViewerClose').onclick=close;
  $('imageViewerPrev').onclick=()=>move(-1);$('imageViewerNext').onclick=()=>move(1);
  $('imageViewerZoomOut').onclick=()=>zoom(scale/1.25);$('imageViewerZoomIn').onclick=()=>zoom(scale*1.25);
  $('imageViewerFit').onclick=fit;$('imageViewerOriginal').onclick=original;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(!dialog.open){releaseImage();files=[];unlockPage();}});
  dialog.addEventListener('click',e=>{if(e.target===dialog)close();});
  dialog.addEventListener('keydown',e=>{
    const action={'ArrowLeft':()=>move(-1),'ArrowRight':()=>move(1),'+':()=>zoom(scale*1.25),'=':()=>zoom(scale*1.25),'-':()=>zoom(scale/1.25),'0':fit,'1':original}[e.key];
    if(action){e.preventDefault();action();}
  });
  stage.addEventListener('wheel',e=>{
    e.preventDefault();if(!width)return;
    const rect=stage.getBoundingClientRect();zoom(scale*Math.exp(clamp(-e.deltaY*.002,-.4,.4)),e.clientX-rect.left-stage.clientWidth/2,e.clientY-rect.top-stage.clientHeight/2);
  },{passive:false});
  stage.addEventListener('dblclick',e=>{
    if(!width)return;if(Math.abs(scale-1)<.001)fit();else{
      const rect=stage.getBoundingClientRect();zoom(1,e.clientX-rect.left-stage.clientWidth/2,e.clientY-rect.top-stage.clientHeight/2);
    }
  });
  stage.addEventListener('pointerdown',e=>{
    if(e.button!==0||!width||!stage.classList.contains('can-drag'))return;e.preventDefault();stage.setPointerCapture(e.pointerId);
    drag={id:e.pointerId,startX:e.clientX,startY:e.clientY,x,y};stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove',e=>{if(!drag||drag.id!==e.pointerId)return;x=drag.x+e.clientX-drag.startX;y=drag.y+e.clientY-drag.startY;paint();});
  function endDrag(e){if(!drag||drag.id!==e.pointerId)return;drag=null;stage.classList.remove('dragging');if(stage.hasPointerCapture(e.pointerId))stage.releasePointerCapture(e.pointerId);}
  stage.addEventListener('pointerup',endDrag);stage.addEventListener('pointercancel',endDrag);stage.addEventListener('lostpointercapture',endDrag);
  new ResizeObserver(()=>{if(dialog.open&&width){if(mode==='fit')fit();else paint();}}).observe(stage);
  root.QFImageViewer={open,close};
})(globalThis);
