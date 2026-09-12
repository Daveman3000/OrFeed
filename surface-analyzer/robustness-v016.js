(function(root){
  'use strict';
  const API=root.SurfaceRobustnessEngineV016;if(!API)throw new Error('Robustness engine v016 missing');
  const {VERSION,TAU,DRIVER_METRICS,DESCRIPTOR,buildVolspikeConfigs,buildSemanticGraph,compute:normalizeAndCompose,runSyntheticSuite}=API;
  function waitInstall(){
    if(typeof ROWS==='undefined'||typeof COLS==='undefined'||typeof meta==='undefined'||!meta||!meta.__order__){setTimeout(waitInstall,25);return;}
    installBrowser();
  }
  function installBrowser(){
    const ACCEPTANCE=runSyntheticSuite();
    const GRAPH=buildSemanticGraph(buildVolspikeConfigs(ROWS,COLS,meta.__order__),DESCRIPTOR);
    const graphContractPassed=GRAPH.surfaceCells.size===6&&GRAPH.components===160&&GRAPH.missingExpectedDirect===0;
    const GATE=ACCEPTANCE.passed&&graphContractPassed;
    const robustKey=k=>`sr:${k}`,driverFromKey=k=>k&&k.startsWith('sr:')?k.slice(3):null;
    for(const k of DRIVER_METRICS){const rk=robustKey(k);robustnessKeys.add(rk);meta[rk]={label:`Structural Robustness · ${meta[k]?.label||k}`,lo:0,hi:1,invert:false,decimals:3,group:'robustness'};}
    lastRobustnessKey=robustKey(lastPerformanceKey||'r_per_trade');

    function ensureStore(surface){if(!surface.robustnessByMetric||surface.robustnessVersion!==VERSION){surface.robustnessByMetric={};surface.robustnessVersion=VERSION;}return surface.robustnessByMetric;}
    function ensureMetric(surface,metric){
      if(!GATE)throw new Error('Semantic robustness acceptance gate failed');
      const store=ensureStore(surface),old=store[metric];
      if(old&&old.version===VERSION&&old.structural_robustness?.length===ROWS*COLS){if(!(old.structural_robustness instanceof Float32Array))old.structural_robustness=new Float32Array(old.structural_robustness);return old;}
      const vals=surface.metrics[metric];if(!vals)throw new Error(`Uploaded CSV does not contain ${metric}`);
      const full=normalizeAndCompose(vals,GRAPH),result={version:VERSION,metric,tau:TAU,structural_robustness:full.structural_robustness};
      store[metric]=result;idbSetActive(surface).catch(()=>{});return result;
    }

    const baseNormalizeStoredSurface=normalizeStoredSurface;
    normalizeStoredSurface=function(s){s=baseNormalizeStoredSurface(s);if(!s)return s;if(s.robustnessVersion!==VERSION){delete s.robustnessByMetric;s.robustnessVersion=VERSION;}if(s.robustnessByMetric)for(const r of Object.values(s.robustnessByMetric))if(r?.structural_robustness&&!(r.structural_robustness instanceof Float32Array))r.structural_robustness=new Float32Array(r.structural_robustness);return s;};
    const baseBuildUploadedSurface=buildUploadedSurface;
    buildUploadedSurface=function(text,file){const s=baseBuildUploadedSurface(text,file);s.robustnessVersion=VERSION;s.robustnessByMetric={};return s;};
    const basePopulateMetricOptions=populateMetricOptions;
    populateMetricOptions=function(mode){if(mode!=='robustness'||!activeSurface)return basePopulateMetricOptions(mode);metricSel.innerHTML='';for(const k of DRIVER_METRICS){const rk=robustKey(k),opt=document.createElement('option');opt.value=rk;opt.textContent=meta[rk].label;metricSel.appendChild(opt);}};
    const baseDisplayQ=displayQ;
    displayQ=function(i){if(activeSurface&&currentMode==='robustness'&&driverFromKey(currentKey))return Math.round(clamp01(values[i])*15);return baseDisplayQ(i);};
    const baseRobustApprox=robustApprox;
    robustApprox=function(q){return activeSurface&&driverFromKey(currentKey)?Number(q):baseRobustApprox(q);};
    const baseSetMetric=setMetric;
    setMetric=async function(key){
      const driver=activeSurface?driverFromKey(key):null;if(!driver)return baseSetMetric(key);
      currentKey=key;lastRobustnessKey=key;lastPerformanceKey=driver;loading.style.display='flex';loading.textContent=`Calculating ${meta[key].label}…`;
      try{const r=ensureMetric(activeSurface,driver);values=r.structural_robustness;currentStats=null;loading.style.display='none';statusEl.textContent=`${meta[key].label} · semantic graph · 6 hard surfaces · 160 facet components · global normalization · permutation gate passed`;draw();}
      catch(e){loading.style.display='flex';loading.textContent='Could not calculate robustness: '+e.message;statusEl.textContent=`${meta[key].label} failed`;}
    };
    updateRobustnessAvailability=function(){const b=metricMode.querySelector('button[data-mode="robustness"]');if(!b)return;if(activeSurface){b.disabled=!GATE;b.title=GATE?'Semantic parameter graph; screen layout is visualization only.':'Semantic robustness acceptance gate failed — real robustness disabled.';}else{b.disabled=false;b.title='';}};
    const robustRead=`Structural Robustness follows the <b>selected performance metric</b> and runs on the descriptor-defined semantic configuration graph, not pixel adjacency. The six hard regime surfaces are London-range mode × trade-management mode. Facets never create edges. Legitimate one-step changes in ordered parameters create graph edges, including 1↔2 trades/day; inactive parameters are ignored. R1/R2/R3, symmetric L1 similarity, graph TV, second differences and B2/B3 breadth are computed on that graph, then primitive scores are percentile-normalized <b>globally across all 56,000 cells</b>. Directional stability gives equal conceptual weight to each active ordered parameter before combining TM-vs-context stability.`;
    setMode=async function(mode){
      if(mode===currentMode)return;if(currentMode==='performance'){lastPerformanceKey=currentKey;lastPerformanceView=viewSel.value;}else lastRobustnessKey=currentKey;
      currentMode=mode;for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===mode);setViewForMode(mode);populateMetricOptions(mode);readCopy.innerHTML=mode==='robustness'?robustRead:performanceRead;
      let next;if(mode==='robustness')next=activeSurface?robustKey(lastPerformanceKey||'r_per_trade'):'structural_robustness';else next=lastPerformanceKey;metricSel.value=next;await setMetric(next);
    };
    updateRobustnessAvailability();
    root.SurfaceRobustnessV016={engine:API,acceptance:ACCEPTANCE,graph:GRAPH,gatePassed:GATE};
  }
  waitInstall();
})(typeof window!=='undefined'?window:globalThis);
