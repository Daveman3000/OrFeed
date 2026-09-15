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
    const rr36=!!root.SurfaceRrPresentationV036;
    const scan35=!!root.SurfaceScanLayerV035;
    const scan34=!!root.SurfaceScanLayerV034;
    const scan33=!!root.SurfaceScanLayerV033;
    if(core&&rr36&&scan35){
      el.textContent='v036';
      el.title='v036 RR presentation · scanner v035 · core v030';
      return;
    }
    if(core&&(scan35||scan34||scan33)){
      if(tries++<80){setTimeout(sync,25);return;}
      const v=scan35?'v035':scan34?'v034':'v033';
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
