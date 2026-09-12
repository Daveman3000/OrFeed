(function(root){
  'use strict';
  const DRIVER_METRICS=['r_per_trade','expectancy_per_contract','profit_factor','romad','max_drawdown_r','total_r'];
  function install(){
    if(typeof meta==='undefined'||!meta||!root.SurfaceRobustnessV016||!root.SurfaceFacetReplicationV017){setTimeout(install,25);return;}
    for(const k of DRIVER_METRICS){
      const label=meta[k]?.label||k;
      if(meta[`sr:${k}`])meta[`sr:${k}`].label=label;
      if(meta[`fr:${k}`])meta[`fr:${k}`].label=label;
    }
    const select=document.getElementById('metric');
    if(select)for(const opt of select.options){
      const key=opt.value;
      if(key.startsWith('sr:')||key.startsWith('fr:')){
        const driver=key.slice(3);
        opt.textContent=meta[driver]?.label||driver;
      }
    }
  }
  install();
})(typeof window!=='undefined'?window:globalThis);
