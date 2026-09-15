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
      return;
    }
    const v=document.querySelector('.version');
    if(v)v.textContent='v030';
  }

  sync();
})(typeof window!=='undefined'?window:globalThis);
