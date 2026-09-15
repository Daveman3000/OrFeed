(function(root){
  'use strict';

  const VERSION='scan-regional-ux-v035';
  let installed=false;

  function control(){return document.getElementById('scanLayerControl');}
  function labelCheckbox(text){
    const wrap=control();if(!wrap)return null;
    for(const lab of wrap.querySelectorAll('.sa-scan-display label')){
      if((lab.textContent||'').includes(text))return lab.querySelector('input[type="checkbox"]');
    }
    return null;
  }
  function ensureRegionalOutline(){
    const regional=labelCheckbox('Run Regional Robustness');
    const outline=labelCheckbox('Outline regions');
    if(!regional?.checked||!outline||outline.checked)return;
    outline.checked=true;
    outline.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function reopenAfterApply(previousResult){
    let tries=0;
    const tick=()=>{
      const wrap=control(),scan=root.SurfaceScanLayerV034,btn=wrap?.querySelector('.sa-scan-btn');
      if(!wrap||!scan||!btn)return;
      const finished=!btn.disabled&&btn.textContent!=='Scanning…';
      const fresh=scan.result&&scan.result!==previousResult;
      if(finished&&fresh){
        if(!wrap.classList.contains('open'))btn.click();
        return;
      }
      if(++tries<240)setTimeout(tick,25);
    };
    setTimeout(tick,0);
  }
  function onChange(e){
    const lab=e.target?.closest?.('#scanLayerControl .sa-scan-display label');
    if(!lab||(lab.textContent||'').indexOf('Run Regional Robustness')<0)return;
    if(e.target.checked)ensureRegionalOutline();
  }
  function onClickCapture(e){
    const btn=e.target?.closest?.('#scanLayerControl .sa-scan-actions button');
    if(!btn||btn.textContent.trim()!=='Apply')return;
    ensureRegionalOutline();
    reopenAfterApply(root.SurfaceScanLayerV034?.result||null);
  }
  function install(){
    if(installed)return;
    if(!root.SurfaceScanLayerV034||!control()){setTimeout(install,50);return;}
    installed=true;
    document.addEventListener('change',onChange,true);
    document.addEventListener('click',onClickCapture,true);
    const v=document.querySelector('.version');if(v)v.textContent='v035';
    root.SurfaceScanLayerV035={version:VERSION};
  }

  install();
})(typeof window!=='undefined'?window:globalThis);
