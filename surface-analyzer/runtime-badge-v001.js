(function(root){
  'use strict';
  const el=document.querySelector('.version');
  if(!el)return;
  if(!document.getElementById('runtimeBadgeV001Style')){
    const s=document.createElement('style');
    s.id='runtimeBadgeV001Style';
    s.textContent='.version{font-size:9px!important}.version::after{content:none!important}';
    document.head.appendChild(s);
  }
  el.textContent='v030';
  el.title='core v030 · scanner not yet synchronized';
  let tries=0;
  function sync(){
    const core=!!root.SurfaceSemanticAnalysisV030;
    const scan34=!!root.SurfaceScanLayerV034;
    const scan33=!!root.SurfaceScanLayerV033;
    if(core&&(scan34||scan33)){
      const v=scan34?'v034':'v033';
      el.textContent=v;
      el.title=`${v} synchronized · core v030`;
      return;
    }
    if(tries++<200){setTimeout(sync,25);return;}
    el.textContent=core?'v030 !scan':'!core';
    el.title=core?'core v030 loaded · scanner failed to synchronize':'core failed to synchronize';
  }
  sync();
})(typeof window!=='undefined'?window:globalThis);
