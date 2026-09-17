(function(root){
  'use strict';

  const VERSION='facet-substitution-fiber-v017';
  const EPS=1e-12;
  const DRIVER_METRICS=['r_per_trade','expectancy_per_contract','profit_factor','romad','max_drawdown_r','total_r'];
  const FACETS=[
    {id:'london_close_beyond_asia',label:'London-close',values:[0,1]},
    {id:'pm_close_mode',label:'PM-close',values:[0,1,2,3]},
    {id:'entry_location',label:'Entry-location',values:[0,1]},
    {id:'fixed_target_exit_rule',label:'Exit-rule',values:[0,1]}
  ];

  function finite(v){return Number.isFinite(v);}
  function percentileSorted(sorted,p){
    if(!sorted.length)return NaN;
    const x=(sorted.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x);
    return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo);
  }
  function gm(values){
    const a=values.filter(finite);if(!a.length)return NaN;
    if(a.some(v=>v===0))return 0;
    if(a.some(v=>v<0))return NaN;
    return Math.exp(a.reduce((s,v)=>s+Math.log(Math.min(1,Math.max(0,v))),0)/a.length);
  }
  function midrankLowerBetter(values){
    const out=new Float32Array(values.length),idx=[];
    for(let i=0;i<values.length;i++){if(finite(values[i]))idx.push(i);else out[i]=NaN;}
    if(!idx.length)return out;
    let lo=Infinity,hi=-Infinity;for(const i of idx){const v=values[i];if(v<lo)lo=v;if(v>hi)hi=v;}
    const tol=EPS*Math.max(1,Math.abs(lo),Math.abs(hi));
    if(Math.abs(hi-lo)<=tol){const s=Math.abs(lo)<=tol?1:.5;for(const i of idx)out[i]=s;return out;}
    idx.sort((a,b)=>values[b]-values[a]);
    const den=Math.max(1,idx.length-1);
    for(let s=0;s<idx.length;){
      let e=s+1,anchor=values[idx[s]],tieTol=EPS*Math.max(1,Math.abs(anchor));
      while(e<idx.length&&Math.abs(values[idx[e]]-anchor)<=tieTol)e++;
      const r=((s+e-1)/2)/den;for(let j=s;j<e;j++)out[idx[j]]=r;s=e;
    }
    return out;
  }
  function activeWhen(rule,params){
    if(!rule)return true;
    if(rule.op==='eq')return params[rule.parameter]===rule.value;
    if(rule.op==='in')return rule.values.includes(params[rule.parameter]);
    if(rule.op==='and')return rule.clauses.every(c=>activeWhen(c,params));
    throw new Error(`Unsupported active_when op ${rule.op}`);
  }
  function activeDefs(descriptor,params,role){return descriptor.parameters.filter(p=>p.topology_role===role&&activeWhen(p.active_when,params));}
  function valueToken(v){return typeof v==='number'?String(v):JSON.stringify(v);}
  function orderedIndex(def,value){
    const i=(def.ordered_values||[]).findIndex(v=>Object.is(v,value)||v===value);
    if(i<0)throw new Error(`${def.id}: value ${value} is not in ordered_values`);return i;
  }
  function semanticKey(descriptor,params){
    const parts=[];
    for(const def of descriptor.parameters){
      if(!activeWhen(def.active_when,params))continue;
      if(!['regime','facet','ordered'].includes(def.topology_role))continue;
      if(def.topology_role==='ordered')parts.push(`${def.id}#${orderedIndex(def,params[def.id])}`);
      else parts.push(`${def.id}=${valueToken(params[def.id])}`);
    }
    return parts.join('|');
  }
  function hardKey(descriptor,params){return activeDefs(descriptor,params,'regime').map(d=>`${d.id}=${valueToken(params[d.id])}`).join('|');}
  function facetIsActive(descriptor,params,facetId){const d=descriptor.parameters.find(p=>p.id===facetId);return !!d&&d.topology_role==='facet'&&activeWhen(d.active_when,params);}
  function facetValues(descriptor,facetId){
    const d=descriptor.parameters.find(p=>p.id===facetId),fallback=FACETS.find(f=>f.id===facetId)?.values;
    const vals=d?.values||fallback;if(!vals||!vals.length)throw new Error(`${facetId}: no declared facet values`);return vals;
  }
  function robustScales(values,graph,descriptor){
    const groups=new Map();
    for(let i=0;i<graph.configs.length;i++){
      const hard=graph.configs[i].hard||hardKey(descriptor,graph.configs[i].params);if(!groups.has(hard))groups.set(hard,[]);if(finite(values[i]))groups.get(hard).push(values[i]);
    }
    const scales=new Map();
    for(const [hard,a] of groups){
      a.sort((x,y)=>x-y);if(!a.length){scales.set(hard,{scale:NaN,flat:false});continue;}
      const p5=percentileSorted(a,.05),p95=percentileSorted(a,.95),raw=Math.abs(p95-p5),range=Math.abs(a[a.length-1]-a[0]);
      const tol=EPS*Math.max(1,Math.abs(p5),Math.abs(p95),Math.abs(a[0]),Math.abs(a[a.length-1]));
      if(raw>tol)scales.set(hard,{scale:raw,flat:false,p5,p95});
      else if(range>tol)scales.set(hard,{scale:range,flat:false,p5,p95,fallback:true});
      else scales.set(hard,{scale:1,flat:true,p5,p95});
    }
    return scales;
  }

  function buildLookup(graph){const m=new Map();for(let i=0;i<graph.configs.length;i++){const k=graph.configs[i].key||semanticKey(graph.descriptor,graph.configs[i].params);if(m.has(k))throw new Error(`Duplicate semantic key ${k}`);m.set(k,i);}return m;}
  function facetFiber(graph,descriptor,lookup,cellIndex,facetId,alternative){
    const source=graph.configs[cellIndex],p=source.params;
    if(!facetIsActive(descriptor,p,facetId))return {peers:[],expected:0,eligible:false};
    const current=p[facetId];if(current===alternative)return {peers:[],expected:0,eligible:false};
    const sourceOrdered=new Set(activeDefs(descriptor,p,'ordered').map(d=>d.id));
    const base={...p,[facetId]:alternative};
    const targetOrdered=activeDefs(descriptor,base,'ordered');
    const newlyActive=targetOrdered.filter(d=>!sourceOrdered.has(d.id));
    let combos=[{}];
    for(const def of newlyActive){
      const vals=def.ordered_values||[];if(!vals.length)throw new Error(`${def.id}: newly active ordered parameter has no declared values`);
      const next=[];for(const c of combos)for(const v of vals)next.push({...c,[def.id]:v});combos=next;
    }
    const peers=[];
    for(const c of combos){const q={...base,...c},j=lookup.get(semanticKey(descriptor,q));if(j!==undefined)peers.push(j);}
    return {peers,expected:combos.length,eligible:true};
  }

  function rawFacetDeviations(values,graph,descriptor){
    const N=values.length;if(N!==graph.configs.length)throw new Error('Metric array length does not match semantic graph');
    const lookup=buildLookup(graph),scales=robustScales(values,graph,descriptor),deviation={},coverage={};
    for(const f of FACETS){deviation[f.id]=new Float64Array(N);coverage[f.id]=new Float64Array(N);deviation[f.id].fill(NaN);coverage[f.id].fill(NaN);}
    let missingExpectedPeers=0,expectedPeers=0,availablePeers=0,eligibleAlternativeCount=0;
    for(let i=0;i<N;i++){
      const z=values[i],node=graph.configs[i];if(!finite(z))continue;
      const rs=scales.get(node.hard||hardKey(descriptor,node.params));if(!rs||!finite(rs.scale))continue;
      for(const f of FACETS){
        if(!facetIsActive(descriptor,node.params,f.id))continue;
        const alternativeMeans=[],alternativeCoverage=[],current=node.params[f.id];
        for(const alt of facetValues(descriptor,f.id)){
          if(alt===current)continue;const fiber=facetFiber(graph,descriptor,lookup,i,f.id,alt);if(!fiber.eligible)continue;eligibleAlternativeCount++;
          expectedPeers+=fiber.expected;const ds=[];
          for(const j of fiber.peers){const v=values[j];if(finite(v)){availablePeers++;ds.push(rs.flat?0:Math.abs(v-z)/rs.scale);}}
          missingExpectedPeers+=Math.max(0,fiber.expected-ds.length);
          alternativeCoverage.push(fiber.expected?ds.length/fiber.expected:1);
          if(ds.length)alternativeMeans.push(ds.reduce((a,b)=>a+b,0)/ds.length);
        }
        if(alternativeMeans.length)deviation[f.id][i]=alternativeMeans.reduce((a,b)=>a+b,0)/alternativeMeans.length;
        if(alternativeCoverage.length)coverage[f.id][i]=alternativeCoverage.reduce((a,b)=>a+b,0)/alternativeCoverage.length;
      }
    }
    return {deviation,coverage,scales,diagnostics:{missingExpectedPeers,expectedPeers,availablePeers,eligibleAlternativeCount}};
  }
  function compute(values,graph,descriptor){
    const raw=rawFacetDeviations(values,graph,descriptor),replication={},facetScore={};
    for(const f of FACETS){
      replication[f.id]=midrankLowerBetter(raw.deviation[f.id]);facetScore[f.id]=new Float32Array(values.length);facetScore[f.id].fill(NaN);
      for(let i=0;i<values.length;i++){const r=replication[f.id][i],c=raw.coverage[f.id][i];if(finite(r)&&finite(c))facetScore[f.id][i]=r*Math.min(1,Math.max(0,c));}
    }
    const fr=new Float32Array(values.length);fr.fill(NaN);
    for(let i=0;i<values.length;i++){
      if(!finite(values[i]))continue;const scores=[];
      for(const f of FACETS)if(facetIsActive(descriptor,graph.configs[i].params,f.id)&&finite(facetScore[f.id][i]))scores.push(facetScore[f.id][i]);
      fr[i]=gm(scores);
    }
    return {version:VERSION,raw,replication,facetScore,facet_replication:fr};
  }

  function syntheticSuite(){
    const descriptor={descriptor_schema_version:1,descriptor_version:'fr-synth',study_id:'fr-synth',parameters:[
      {id:'regime',topology_role:'regime'},
      {id:'london_close_beyond_asia',topology_role:'facet',values:[0,1,2]},
      {id:'fixed_target_exit_rule',topology_role:'facet',values:[0,1]},
      {id:'x',topology_role:'ordered',ordered_values:[0,1,2,3]},
      {id:'y',topology_role:'ordered',ordered_values:[0,1,2,3,4],active_when:{op:'eq',parameter:'fixed_target_exit_rule',value:1}}
    ]};
    const configs=[];
    for(const f of [0,1,2])for(const rule of [0,1])for(const x of [0,1,2,3]){
      if(rule===0)configs.push({id:`${f}:${rule}:${x}`,params:{regime:0,london_close_beyond_asia:f,fixed_target_exit_rule:rule,x}});
      else for(const y of [0,1,2,3,4])configs.push({id:`${f}:${rule}:${x}:${y}`,params:{regime:0,london_close_beyond_asia:f,fixed_target_exit_rule:rule,x,y}});
    }
    const T=root.SurfaceTopologyV016;if(!T)throw new Error('Synthetic suite requires SurfaceTopologyV016');
    const graph=T.buildSemanticGraph(configs,descriptor),values=new Float64Array(configs.length);
    for(let i=0;i<configs.length;i++){
      const p=configs[i].params;
      values[i]=(p.x<2?5:5+3*p.london_close_beyond_asia)+(p.fixed_target_exit_rule?0.5:0)+(p.y??0)*0.02;
    }
    const a=compute(values,graph,descriptor),plus=compute(Float64Array.from(values,v=>v+100),graph,descriptor),neg=compute(Float64Array.from(values,v=>-v),graph,descriptor);
    let maxShift=0,maxNeg=0;for(let i=0;i<values.length;i++){maxShift=Math.max(maxShift,Math.abs(a.facet_replication[i]-plus.facet_replication[i]));maxNeg=Math.max(maxNeg,Math.abs(a.facet_replication[i]-neg.facet_replication[i]));}
    const perm=Array.from({length:configs.length},(_,i)=>(i*17)%configs.length);if(new Set(perm).size!==configs.length)throw new Error('Synthetic permutation not bijective');
    const pc=perm.map(i=>configs[i]),pv=Float64Array.from(perm.map(i=>values[i])),pg=T.buildSemanticGraph(pc,descriptor),pa=compute(pv,pg,descriptor),pIndex=new Map(pc.map((c,i)=>[c.id,i]));let maxPerm=0;
    for(let i=0;i<configs.length;i++)maxPerm=Math.max(maxPerm,Math.abs(a.facet_replication[i]-pa.facet_replication[pIndex.get(configs[i].id)]));
    const stable=[],unstable=[];for(let i=0;i<configs.length;i++)(configs[i].params.x<2?stable:unstable).push(a.facet_replication[i]);
    const mean=x=>x.reduce((s,v)=>s+v,0)/x.length,stableMean=mean(stable),unstableMean=mean(unstable);
    const source=configs.findIndex(c=>c.params.london_close_beyond_asia===0&&c.params.fixed_target_exit_rule===0&&c.params.x===0),lookup=buildLookup(graph),fib=facetFiber(graph,descriptor,lookup,source,'fixed_target_exit_rule',1);
    const fiberCountOk=fib.expected===5&&fib.peers.length===5;
    const tests=[
      ['stable facet substitution > unstable',stableMean>unstableMean,{stableMean,unstableMean}],
      ['translation invariant',maxShift<1e-7,{maxShift}],
      ['sign invariant',maxNeg<1e-7,{maxNeg}],
      ['visual permutation invariant',maxPerm<1e-7,{maxPerm}],
      ['activation fiber spans declared domain',fiberCountOk,{expected:fib.expected,actual:fib.peers.length}]
    ];
    return {passed:tests.every(t=>t[1]),tests,summary:{stableMean,unstableMean,maxShift,maxNeg,maxPerm,fiberExpected:fib.expected,fiberActual:fib.peers.length}};
  }

  const API={VERSION,DRIVER_METRICS,FACETS,facetFiber,rawFacetDeviations,compute,runSyntheticSuite:syntheticSuite};
  root.SurfaceFacetReplicationEngineV017=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;

  if(typeof window==='undefined')return;
  function waitInstall(){if(!root.SurfaceRobustnessV016||!root.SurfaceTopologyV016||typeof meta==='undefined'||!meta||typeof activeSurface==='undefined'){setTimeout(waitInstall,25);return;}installBrowser();}
  function installBrowser(){
    const SR=root.SurfaceRobustnessV016,graph=SR.graph,descriptor=SR.engine.DESCRIPTOR,acceptance=syntheticSuite(),gate=acceptance.passed&&SR.gatePassed;
    let lastFacetKey='fr:r_per_trade',activeFacetResult=null;
    const frKey=k=>`fr:${k}`,driverFromFr=k=>k&&k.startsWith('fr:')?k.slice(3):null;
    for(const k of DRIVER_METRICS){const fk=frKey(k);robustnessKeys.add(fk);meta[fk]={label:`Facet Replication · ${meta[k]?.label||k}`,lo:0,hi:1,invert:false,decimals:3,group:'facet_replication'};}
    function ensureStore(surface){if(!surface.facetReplicationByMetric||surface.facetReplicationVersion!==VERSION){surface.facetReplicationByMetric={};surface.facetReplicationVersion=VERSION;}return surface.facetReplicationByMetric;}
    function rehydrate(r){if(!r)return r;if(r.facet_replication&&!(r.facet_replication instanceof Float32Array))r.facet_replication=new Float32Array(r.facet_replication);if(r.facetScore)for(const f of FACETS)if(r.facetScore[f.id]&&!(r.facetScore[f.id] instanceof Float32Array))r.facetScore[f.id]=new Float32Array(r.facetScore[f.id]);return r;}
    function ensureMetric(surface,metric){
      if(!gate)throw new Error('Facet Replication acceptance gate failed');const store=ensureStore(surface),old=rehydrate(store[metric]);if(old&&old.version===VERSION&&old.facet_replication?.length===ROWS*COLS)return old;
      const vals=surface.metrics[metric];if(!vals)throw new Error(`Uploaded CSV does not contain ${metric}`);const full=compute(vals,graph,descriptor),result={version:VERSION,metric,facet_replication:full.facet_replication,facetScore:full.facetScore,diagnostics:full.raw.diagnostics};store[metric]=result;idbSetActive(surface).catch(()=>{});return result;
    }
    const baseNormalizeStoredSurface=normalizeStoredSurface;normalizeStoredSurface=function(s){s=baseNormalizeStoredSurface(s);if(!s)return s;if(s.facetReplicationVersion!==VERSION){delete s.facetReplicationByMetric;s.facetReplicationVersion=VERSION;}if(s.facetReplicationByMetric)for(const k of Object.keys(s.facetReplicationByMetric))s.facetReplicationByMetric[k]=rehydrate(s.facetReplicationByMetric[k]);return s;};
    const baseBuildUploadedSurface=buildUploadedSurface;buildUploadedSurface=function(text,file){const s=baseBuildUploadedSurface(text,file);s.facetReplicationVersion=VERSION;s.facetReplicationByMetric={};return s;};
    const baseSetViewForMode=setViewForMode;setViewForMode=function(mode){if(mode==='facet'){lastPerformanceView=viewSel.value;viewSel.innerHTML='<option value="raw">Score</option>';viewSel.value='raw';return;}return baseSetViewForMode(mode);};
    const basePopulateMetricOptions=populateMetricOptions;populateMetricOptions=function(mode){if(mode!=='facet'||!activeSurface)return basePopulateMetricOptions(mode);metricSel.innerHTML='';for(const k of DRIVER_METRICS){const fk=frKey(k),opt=document.createElement('option');opt.value=fk;opt.textContent=meta[fk].label;metricSel.appendChild(opt);}};
    const baseDisplayQ=displayQ;displayQ=function(i){if(activeSurface&&currentMode==='facet'&&driverFromFr(currentKey))return Math.round(clamp01(values[i])*15);return baseDisplayQ(i);};
    const baseRobustApprox=robustApprox;robustApprox=function(q){return activeSurface&&currentMode==='facet'&&driverFromFr(currentKey)?Number(q):baseRobustApprox(q);};
    const baseSetMetric=setMetric;setMetric=async function(key){
      const driver=activeSurface?driverFromFr(key):null;if(!driver)return baseSetMetric(key);currentKey=key;lastFacetKey=key;lastPerformanceKey=driver;loading.style.display='flex';loading.textContent=`Calculating ${meta[key].label}…`;
      try{activeFacetResult=ensureMetric(activeSurface,driver);values=activeFacetResult.facet_replication;currentStats=null;loading.style.display='none';const d=activeFacetResult.diagnostics;statusEl.textContent=`${meta[key].label} · facet-substitution fibers · equal alternative weighting · ${d.missingExpectedPeers} missing expected peers · synthetic gate passed`;draw();}
      catch(e){loading.style.display='flex';loading.textContent='Could not calculate facet replication: '+e.message;statusEl.textContent=`${meta[key].label} failed`;}
    };
    const baseUpdate=updateRobustnessAvailability;updateRobustnessAvailability=function(){baseUpdate();const b=metricMode.querySelector('button[data-mode="facet"]');if(!b)return;b.disabled=!activeSurface||!gate;b.title=!activeSurface?'Facet Replication requires an uploaded exact CSV.':gate?'Unordered facet-substitution robustness; independent of Structural Robustness.':'Facet Replication acceptance gate failed.';};
    const facetRead=`Facet Replication asks whether the <b>same ordered configuration</b> behaves similarly when one unordered facet is substituted. Shared active ordered coordinates are preserved; coordinates that become inactive are projected away; newly active ordered coordinates expand across their full declared domain. Each categorical alternative gets equal weight after averaging within its substitution fiber. London-close, PM-close, Entry-location and Exit-rule replication are scored separately, then combined by geometric mean. <b>No facet substitution creates Structural Robustness graph edges.</b>`;
    setMode=async function(mode){
      if(mode===currentMode)return;if(currentMode==='performance'){lastPerformanceKey=currentKey;lastPerformanceView=viewSel.value;}else if(currentMode==='facet')lastFacetKey=currentKey;else lastRobustnessKey=currentKey;
      currentMode=mode;for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===mode);setViewForMode(mode);populateMetricOptions(mode);readCopy.innerHTML=mode==='facet'?facetRead:mode==='robustness'?`Structural Robustness follows the <b>selected performance metric</b> and runs on the descriptor-defined semantic configuration graph, not pixel adjacency. The six hard regime surfaces are London-range mode × trade-management mode. Facets never create edges. Legitimate one-step changes in ordered parameters create graph edges, including 1↔2 trades/day; inactive parameters are ignored. R1/R2/R3, symmetric L1 similarity, graph TV, second differences and B2/B3 breadth are computed on that graph, then primitive scores are percentile-normalized <b>globally across all 56,000 cells</b>. Directional stability gives equal conceptual weight to each active ordered parameter before combining TM-vs-context stability.`:performanceRead;
      let next;if(mode==='facet')next=activeSurface?(driverFromFr(lastFacetKey)?lastFacetKey:frKey(lastPerformanceKey||'r_per_trade')):'r_per_trade';else if(mode==='robustness')next=activeSurface?`sr:${lastPerformanceKey||'r_per_trade'}`:'structural_robustness';else next=lastPerformanceKey;metricSel.value=next;await setMetric(next);
    };
    canvas.addEventListener('mousemove',e=>{
      if(currentMode!=='facet'||!activeSurface||!activeFacetResult||!values)return;const r=canvas.getBoundingClientRect(),col=Math.max(0,Math.min(COLS-1,Math.floor((e.clientX-r.left)/r.width*COLS))),row=Math.max(0,Math.min(ROWS-1,Math.floor((e.clientY-r.top)/r.height*ROWS))),idx=row*COLS+col;
      const o=outerInfo(row),orig=meta.__order__[col],inn=innerInfo(orig),parts=[];for(const f of FACETS){const a=activeFacetResult.facetScore?.[f.id],v=a?.[idx];if(finite(v))parts.push(`<span>${f.label}: <b>${v.toFixed(3)}</b></span>`);}
      hover.innerHTML=`<span>Outer: <b>${row+1} / 224</b></span><span>Inner: <b>${orig+1} / 250</b></span><span>Metric: <b>${meta[currentKey].label}</b></span><span>Range: <b>${o.mode} · ${o.threshold}</b></span><span>Management: <b>${inn.mode} · ${inn.trades} trade${inn.trades===1?'':'s'}</b></span><span>Stop: <b>${inn.stop}% London</b></span><span>Facet Replication: <b>${Number(values[idx]).toFixed(3)}</b></span>${parts.join('')}`;
    });
    updateRobustnessAvailability();root.SurfaceFacetReplicationV017={engine:API,acceptance,gatePassed:gate};
  }
  waitInstall();
})(typeof window!=='undefined'?window:globalThis);
