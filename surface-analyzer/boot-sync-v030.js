(function(root){
  'use strict';
  let done=false,tries=0;

  function ready(){
    return typeof activeSurface!=='undefined'&&
      !!activeSurface?.semanticDescriptor&&
      typeof activateSurface==='function'&&
      !!root.AxisLayerControlsV023&&
      !!root.SurfaceAutoFormatV026&&
      !!root.SurfaceFilterV029&&
      !!root.SurfaceSemanticAnalysisV030;
  }

  async function sync(){
    if(done)return;
    if(!ready()){
      if(tries++<400)setTimeout(sync,25);
      return;
    }
    done=true;
    try{
      const restored=activeSurface;
      await activateSurface(restored,{persist:false});
    }catch(err){
      done=false;
      console.error('Surface Analyzer boot sync failed:',err);
    }
  }

  sync();
})(typeof window!=='undefined'?window:globalThis);

(function(){
  if(typeof document==='undefined'||document.getElementById('runtimeBadgeV001Script'))return;
  const s=document.createElement('script');
  s.id='runtimeBadgeV001Script';
  s.src='runtime-badge-v001.js?v=001';
  document.head.appendChild(s);
})();
