(function(root){
  'use strict';

  const VERSION='multi-variable-scan-v031',SCHEMA_VERSION=1,STORE='surface-analyzer-scan-layer:v1:';
  const finite=Number.isFinite;

  function midrankPercentile(values,invert){
    const out=new Float32Array(values.length),idx=[];
    for(let i=0;i<values.length;i++){if(finite(values[i]))idx.push(i);else out[i]=NaN;}
    if(!idx.length)return out;
    idx.sort((a,b)=>values[a]-values[b]);
    const den=Math.max(1,idx.length-1);
    for(let s=0;s<idx.length;){let e=s+1;while(e<idx.length&&values[idx[e]]===values[idx[s]])e++;let r=((s+e-1)/2)/den;if(invert)r=1-r;for(let j=s;j<e;j++)out[idx[j]]=r*100;s=e;}
    return out;
  }
  function passes(v,op,t){if(!finite(v)||!finite(t))return false;return op==='<='?v<=t:v>=t;}
  function connectedRegions(mask,g,minCells){
    const N=mask.length,seen=new Uint8Array(N),queue=new Int32Array(N),raw=[];
    for(let i=0;i<N;i++)if(mask[i]&&!seen[i]){let h=0,t=0;queue[t++]=i;seen[i]=1;const cells=[];while(h<t){const u=queue[h++];cells.push(u);for(let e=g.offsets[u];e<g.offsets[u+1];e++){const v=g.neighbors[e];if(mask[v]&&!seen[v]){seen[v]=1;queue[t++]=v;}}}raw.push(cells);}
    const kept=raw.filter(c=>c.length>=minCells).sort((a,b)=>b.length-a.length),finalMask=new Uint8Array(N),regionId=new Int32Array(N);regionId.fill(-1);
    for(let r=0;r<kept.length;r++)for(const i of kept[r]){finalMask[i]=1;regionId[i]=r;}
    return {mask:finalMask,regionId,regions:kept};
  }
  function semanticRegionSummary(cells,g){
    const signature=(ks)=>{const out={};for(const k of ks){const vals=new Set();for(const i of cells){const vi=g.paramArrays[k][i];if(vi>=0)vals.add(vi);}out[g.info.defs[k].id]=[...vals].map(vi=>(g.info.defs[k].values||g.info.defs[k].ordered_values||[])[vi]);}return out;};
    const orderedSpan={};for(const k of g.info.ordered){let lo=Infinity,hi=-Infinity;const vals=new Set();for(const i of cells){const vi=g.paramArrays[k][i];if(vi<0)continue;vals.add(vi);lo=Math.min(lo,vi);hi=Math.max(hi,vi);}if(vals.size)orderedSpan[g.info.defs[k].id]={min_index:lo,max_index:hi,unique_values:vals.size};}
    return {cell_count:cells.length,regime_signature:signature(g.info.regimes),facet_signature:signature(g.info.facets),ordered_span:orderedSpan};
  }
  async function evaluateScan(surface,config,g,seriesResolver){
    const N=surface.rows*surface.cols,criteria=(config.criteria||[]).filter(c=>c.enabled!==false),mask=new Uint8Array(N);mask.fill(1);const resolved=[];
    if(!criteria.length)return {mask:new Uint8Array(N),regionId:new Int32Array(N).fill(-1),regions:[],passingCells:0,totalCells:N,criteria:[]};
    for(const c of criteria){const a=await seriesResolver(c);if(!a||a.length!==N)throw new Error(`${c.id||c.metric}: criterion series length mismatch`);resolved.push({criterion:c,values:a});for(let i=0;i<N;i++)if(mask[i]&&!passes(a[i],c.operator,c.value))mask[i]=0;}
    const minCells=Math.max(1,Math.trunc(Number(config.region_rules?.min_cells)||1)),regions=connectedRegions(mask,g,minCells),summaries=regions.regions.map((cells,i)=>({region_id:i+1,...semanticRegionSummary(cells,g)}));let passing=0;for(const v of regions.mask)passing+=v;
    return {mask:regions.mask,regionId:regions.regionId,regions:summaries,passingCells:passing,totalCells:N,criteria:resolved.map(x=>x.criterion)};
  }

  const API={VERSION,SCHEMA_VERSION,midrankPercentile,connectedRegions,evaluateScan};
  root.SurfaceScanEngineV031=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(typeof window==='undefined')return;

  let installed=false,currentIdentity='',config=null,draft=null,result=null,graphSurface=null,graph=null,analysisSurface=null,analysisCache=new Map(),scanToken=0;
  const defaultConfig=()=>({scan_schema_version:SCHEMA_VERSION,scan_id:'candidate_region_scan',enabled:false,criteria_mode:'all',criteria:[],region_rules:{connectivity:'semantic_ordered_graph',min_cells:1},display:{dim_nonpassing:true,outline_regions:true,show_matches_only:false}});
  const clone=o=>JSON.parse(JSON.stringify(o));
  function surfaceIdentity(surface){const d=surface?.semanticDescriptor||{},p=d.provenance||{},hash=p.source_sha256||p.source?.sha256||p.semantic_csv_sha256||p.canonical_results_sha256||'';if(hash)return `${d.study_id||'surface'}:sha:${hash}`;const run=[p.job_id,p.run_id,p.data_generation_id,p.backtester_build].filter(v=>v!=null&&v!=='').join('|');if(run)return `${d.study_id||'surface'}:run:${run}`;return `${d.study_id||'surface'}:file:${surface?.fileName||'surface'}|${surface?.fileSize||0}`;}
  function storageKey(){return STORE+currentIdentity;}
  function loadConfig(){config=defaultConfig();try{const x=JSON.parse(localStorage.getItem(storageKey())||'null');if(x?.scan_schema_version===SCHEMA_VERSION)config={...config,...x,region_rules:{...config.region_rules,...x.region_rules},display:{...config.display,...x.display},criteria:Array.isArray(x.criteria)?x.criteria:[]};}catch{}draft=clone(config);}
  function saveConfig(){localStorage.setItem(storageKey(),JSON.stringify(config));}
  function performanceMetrics(){const declared=activeSurface?.semanticDescriptor?.results?.metrics||[];const keys=declared.length?declared:Object.keys(activeSurface?.metrics||{});return keys.filter(k=>activeSurface?.metrics?.[k]);}
  function driverMetrics(){const all=root.SurfaceSemanticAnalysisV030?.DRIVER_METRICS||[];return all.filter(k=>activeSurface?.metrics?.[k]);}
  function label(k){return meta?.[k]?.label||String(k).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}
  function defaultCriterion(){const metric=performanceMetrics()[0]||'r_per_trade',inv=!!meta?.[metric]?.invert;return {id:`criterion_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,enabled:true,source:'performance',metric,basis:'raw',operator:inv?'<=':'>=',value:null};}
  function normalizeCriterion(c){if(c.source!=='performance'){c.basis='score';if(c.operator!=='<='&&c.operator!=='>=')c.operator='>=';}else if(c.basis!=='percentile')c.basis='raw';return c;}

  function ensureGraph(){
    if(graphSurface===activeSurface&&graph)return graph;
    const browser=root.SurfaceSemanticAnalysisBrowserV030,g0=browser?.graph,first=activeSurface?.semanticDescriptor?.parameters?.[0]?.id;
    if(g0&&first&&g0.N===activeSurface.rows*activeSurface.cols&&g0.paramArrays?.[0]===activeSurface.semanticParameterIndices?.[first])graph=g0;
    else graph=root.SurfaceSemanticAnalysisV030.buildTopology(activeSurface);
    graphSurface=activeSurface;return graph;
  }
  function resetAnalysis(){graphSurface=null;graph=null;analysisSurface=activeSurface;analysisCache=new Map();result=null;scanToken++;}
  function scoreSeries(kind,metric){
    if(currentMode===kind&&currentKey===`${kind==='robustness'?'sr':'fr'}:${metric}`&&values?.length===activeSurface.rows*activeSurface.cols)return values;
    if(analysisSurface!==activeSurface){analysisSurface=activeSurface;analysisCache=new Map();}
    const key=`${kind}:${metric}`;if(analysisCache.has(key))return analysisCache.get(key);const g=ensureGraph(),src=activeSurface.metrics[metric];if(!src)throw new Error(`Surface does not contain ${metric}`);let a;if(kind==='robustness')a=root.SurfaceSemanticAnalysisV030.computeSR(src,g).structural_robustness;else a=root.SurfaceSemanticAnalysisV030.computeFR(src,g).facet_replication;analysisCache.set(key,a);return a;
  }
  async function resolveSeries(c){
    if(c.source==='performance'){
      const raw=activeSurface.metrics[c.metric];if(!raw)throw new Error(`Surface does not contain ${c.metric}`);if(c.basis==='percentile')return midrankPercentile(raw,!!meta?.[c.metric]?.invert);return raw;
    }
    if(c.source==='structural_robustness')return scoreSeries('robustness',c.metric);
    if(c.source==='facet_replication')return scoreSeries('facet',c.metric);
    throw new Error(`Unsupported scan source ${c.source}`);
  }

  function injectStyle(){if(document.getElementById('scanLayerV031Style'))return;const s=document.createElement('style');s.id='scanLayerV031Style';s.textContent=`
    .sa-scan-wrap{position:relative}.sa-scan-btn.active{box-shadow:inset 0 0 0 1px #8ba7c3;color:#fff}.sa-scan-pop{display:none;position:absolute;right:0;top:38px;z-index:95;width:650px;max-width:min(94vw,650px);max-height:72vh;overflow:auto;background:#111821;border:1px solid #34404d;border-radius:10px;box-shadow:0 18px 46px #000a;padding:11px}.sa-scan-wrap.open .sa-scan-pop{display:block}.sa-scan-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:9px}.sa-scan-title{font-size:12px;font-weight:800;color:#e0e7ee}.sa-scan-actions{display:flex;gap:6px}.sa-scan-actions button,.sa-scan-add{font-size:10px;padding:5px 8px}.sa-scan-master{display:flex;align-items:center;gap:7px;font-size:11px;color:#c9d2dc;margin:5px 0 9px}.sa-scan-section{font-size:9px;font-weight:800;letter-spacing:.12em;color:#697785;margin:10px 0 5px}.sa-scan-row{display:grid;grid-template-columns:120px minmax(150px,1fr) 92px 62px 88px 28px;gap:6px;align-items:center;padding:5px 0;border-top:1px solid #26313d}.sa-scan-row select,.sa-scan-row input[type=number],.sa-scan-region input{width:100%;background:#0d141c;color:#e7edf3;border:1px solid #34404d;border-radius:5px;padding:5px 6px;font:inherit;font-size:10px}.sa-scan-row button{border:0;background:transparent;color:#82909d;font-size:15px;cursor:pointer}.sa-scan-row button:hover{color:#e7a0a6}.sa-scan-add{margin-top:7px;border:0;border-radius:6px;background:#26313d;color:#eef3f7;font-weight:700;cursor:pointer}.sa-scan-region{display:grid;grid-template-columns:130px 90px 1fr;gap:8px;align-items:center;font-size:10px;color:#b8c3cd}.sa-scan-display{display:flex;flex-wrap:wrap;gap:8px 15px;margin-top:7px;font-size:10px;color:#b8c3cd}.sa-scan-display label,.sa-scan-master{cursor:pointer}.sa-scan-note,.sa-scan-summary{margin-top:9px;padding-top:8px;border-top:1px solid #26313d;color:#71808f;font-size:9px;line-height:1.45}.sa-scan-summary{color:#a9b6c2}.sa-scan-error{display:none;color:#e7a0a6;margin-top:7px;font-size:9px}.sa-scan-overlay{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;border-radius:5px;image-rendering:pixelated}
    @media(max-width:760px){.sa-scan-row{grid-template-columns:1fr 1fr}.sa-scan-pop{right:-40px}}
  `;document.head.appendChild(s);}
  function ensureOverlay(){const wrap=document.querySelector('.canvaswrap');if(!wrap)return null;let o=document.getElementById('scanLayerOverlay');if(!o){o=document.createElement('canvas');o.id='scanLayerOverlay';o.className='sa-scan-overlay';wrap.appendChild(o);}return o;}
  function clearOverlay(){const o=ensureOverlay();if(o){const c=o.getContext('2d');c.clearRect(0,0,o.width,o.height);}}
  function renderOverlay(){
    const o=ensureOverlay();if(!o)return;if(!config?.enabled||!result||result.totalCells!==activeSurface?.rows*activeSurface?.cols){clearOverlay();return;}const rows=activeSurface.rows,cols=activeSurface.cols;if(o.width!==cols)o.width=cols;if(o.height!==rows)o.height=rows;const c=o.getContext('2d'),im=c.createImageData(cols,rows),showOnly=!!config.display?.show_matches_only,dim=!!config.display?.dim_nonpassing,outline=!!config.display?.outline_regions,mask=result.mask,rids=result.regionId;
    for(let i=0;i<mask.length;i++){const p=i*4;if(!mask[i]&&(showOnly||dim)){im.data[p]=4;im.data[p+1]=7;im.data[p+2]=10;im.data[p+3]=showOnly?238:158;continue;}if(mask[i]&&outline){const r=Math.floor(i/cols),col=i-r*cols,id=rids[i],edge=col===0||col===cols-1||r===0||r===rows-1||(col>0&&rids[i-1]!==id)||(col+1<cols&&rids[i+1]!==id)||(r>0&&rids[i-cols]!==id)||(r+1<rows&&rids[i+cols]!==id);if(edge){im.data[p]=224;im.data[p+1]=234;im.data[p+2]=244;im.data[p+3]=235;}}}
    c.clearRect(0,0,cols,rows);c.putImageData(im,0,0);
  }
  function ensureControl(){const controls=document.querySelector('.controls');if(!controls)return null;let wrap=document.getElementById('scanLayerControl');if(wrap)return wrap;wrap=document.createElement('div');wrap.id='scanLayerControl';wrap.className='ctrl sa-scan-wrap';wrap.innerHTML='<button class="sa-scan-btn" type="button">Scan Layer ▾</button><div class="sa-scan-pop"></div>';const axis=document.getElementById('axisLayerControl');controls.insertBefore(wrap,axis||controls.querySelector('.legend'));wrap.querySelector('.sa-scan-btn').addEventListener('click',e=>{e.stopPropagation();if(!activeSurface?.semanticDescriptor)return;draft=clone(config||defaultConfig());renderMenu();wrap.classList.toggle('open');});document.addEventListener('click',e=>{if(!wrap.contains(e.target))wrap.classList.remove('open');});return wrap;}
  function option(value,text,selected){const o=document.createElement('option');o.value=value;o.textContent=text;o.selected=selected;return o;}
  function renderCriterion(row,c,index){
    const sources=[['performance','Performance'],['structural_robustness','Structural Robustness'],['facet_replication','Facet Replication']],src=document.createElement('select');for(const [v,t] of sources)src.appendChild(option(v,t,c.source===v));const met=document.createElement('select'),basis=document.createElement('select'),op=document.createElement('select'),val=document.createElement('input'),del=document.createElement('button');val.type='number';val.step='any';val.placeholder='threshold';val.value=c.value==null?'':String(c.value);del.type='button';del.textContent='×';
    const fillMetrics=()=>{met.innerHTML='';const ms=c.source==='performance'?performanceMetrics():driverMetrics();for(const k of ms)met.appendChild(option(k,label(k),c.metric===k));if(!ms.includes(c.metric))c.metric=ms[0]||'';met.value=c.metric;};
    const fillBasis=()=>{basis.innerHTML='';if(c.source==='performance'){basis.disabled=false;basis.appendChild(option('raw','Raw',c.basis==='raw'));basis.appendChild(option('percentile','Percentile',c.basis==='percentile'));}else{c.basis='score';basis.disabled=true;basis.appendChild(option('score','Score',true));}};
    const fillOp=()=>{op.innerHTML='';op.appendChild(option('>=','≥',c.operator==='>='));op.appendChild(option('<=','≤',c.operator==='<='));};
    fillMetrics();fillBasis();fillOp();src.addEventListener('change',()=>{c.source=src.value;if(c.source!=='performance'){c.metric=driverMetrics()[0]||'';c.basis='score';c.operator='>=';}else{c.metric=performanceMetrics()[0]||'';c.basis='raw';c.operator=meta?.[c.metric]?.invert?'<=':'>=';}renderMenu();});met.addEventListener('change',()=>{c.metric=met.value;if(c.source==='performance'&&c.basis==='raw')c.operator=meta?.[c.metric]?.invert?'<=':'>=';renderMenu();});basis.addEventListener('change',()=>{c.basis=basis.value;if(c.basis==='percentile')c.operator='>=';else c.operator=meta?.[c.metric]?.invert?'<=':'>=';renderMenu();});op.addEventListener('change',()=>c.operator=op.value);val.addEventListener('input',()=>c.value=val.value===''?null:Number(val.value));del.addEventListener('click',()=>{draft.criteria.splice(index,1);renderMenu();});row.append(src,met,basis,op,val,del);
  }
  function renderMenu(){
    const wrap=ensureControl();if(!wrap||!activeSurface?.semanticDescriptor)return;const pop=wrap.querySelector('.sa-scan-pop');pop.innerHTML='<div class="sa-scan-head"><div class="sa-scan-title">Multi-variable scan</div><div class="sa-scan-actions"><button data-act="reset" type="button">Reset</button><button data-act="apply" type="button">Apply</button></div></div>';const master=document.createElement('label');master.className='sa-scan-master';const on=document.createElement('input');on.type='checkbox';on.checked=!!draft.enabled;on.addEventListener('change',()=>draft.enabled=on.checked);master.append(on,document.createTextNode(' Enable scan overlay'));pop.appendChild(master);const sec=document.createElement('div');sec.className='sa-scan-section';sec.textContent='ALL CRITERIA MUST PASS';pop.appendChild(sec);
    draft.criteria.forEach((c,i)=>{normalizeCriterion(c);const row=document.createElement('div');row.className='sa-scan-row';renderCriterion(row,c,i);pop.appendChild(row);});const add=document.createElement('button');add.type='button';add.className='sa-scan-add';add.textContent='+ Add criterion';add.addEventListener('click',()=>{draft.criteria.push(defaultCriterion());renderMenu();});pop.appendChild(add);
    const rsec=document.createElement('div');rsec.className='sa-scan-section';rsec.textContent='REGION';pop.appendChild(rsec);const rr=document.createElement('div');rr.className='sa-scan-region';rr.innerHTML='<span>Minimum region cells</span>';const min=document.createElement('input');min.type='number';min.min='1';min.step='1';min.value=String(draft.region_rules?.min_cells||1);min.addEventListener('input',()=>draft.region_rules.min_cells=Math.max(1,Math.trunc(Number(min.value)||1)));rr.append(min,document.createTextNode('Semantic graph connectivity'));pop.appendChild(rr);
    const dsec=document.createElement('div');dsec.className='sa-scan-section';dsec.textContent='DISPLAY';pop.appendChild(dsec);const disp=document.createElement('div');disp.className='sa-scan-display';for(const [key,text] of [['dim_nonpassing','Dim failures'],['outline_regions','Outline regions'],['show_matches_only','Show matches only']]){const lab=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.checked=!!draft.display[key];cb.addEventListener('change',()=>draft.display[key]=cb.checked);lab.append(cb,document.createTextNode(' '+text));disp.appendChild(lab);}pop.appendChild(disp);
    const err=document.createElement('div');err.className='sa-scan-error';pop.appendChild(err);const sum=document.createElement('div');sum.className='sa-scan-summary';sum.textContent=result?`${result.passingCells.toLocaleString()} / ${result.totalCells.toLocaleString()} cells · ${result.regions.length.toLocaleString()} semantic regions${result.regions.length?` · largest ${result.regions[0].cell_count.toLocaleString()} cells`:''}`:'No active scan result.';pop.appendChild(sum);const note=document.createElement('div');note.className='sa-scan-note';note.textContent='The scan is downstream of Surface Filter and SR/FR. It never changes topology or robustness. Performance percentiles are desirability percentiles (100 = best, respecting metric direction). “Show matches only” is display-only.';pop.appendChild(note);
    pop.querySelector('[data-act="apply"]').addEventListener('click',async()=>{try{for(const c of draft.criteria){if(!c.metric)throw new Error('Each criterion needs a metric.');if(c.value==null||!finite(Number(c.value)))throw new Error('Each criterion needs a numeric threshold.');c.value=Number(c.value);}if(draft.enabled&&!draft.criteria.length)throw new Error('Add at least one criterion or disable the scan.');config=clone(draft);saveConfig();wrap.classList.remove('open');await recompute();}catch(e){err.style.display='block';err.textContent=e.message;}});
    pop.querySelector('[data-act="reset"]').addEventListener('click',()=>{config=defaultConfig();draft=clone(config);saveConfig();result=null;analysisCache=new Map();updateControl();renderOverlay();renderMenu();});
  }
  function updateControl(){const wrap=ensureControl();if(!wrap)return;const b=wrap.querySelector('.sa-scan-btn'),ok=!!activeSurface?.semanticDescriptor&&!!root.SurfaceSemanticAnalysisV030;b.disabled=!ok;wrap.style.display=activeSurface?.semanticDescriptor?'':'none';b.classList.toggle('active',!!config?.enabled);b.textContent=config?.enabled?'Scan Layer •':'Scan Layer ▾';b.title=result&&config?.enabled?`${result.passingCells.toLocaleString()} matching cells in ${result.regions.length.toLocaleString()} semantic regions`:'Multi-variable performance + robustness scan';}
  async function recompute(){
    const my=++scanToken;updateControl();if(!activeSurface?.semanticDescriptor||!config?.enabled){result=null;renderOverlay();return;}const wrap=ensureControl(),b=wrap?.querySelector('.sa-scan-btn');if(b){b.disabled=true;b.textContent='Scanning…';}try{await new Promise(r=>setTimeout(r,0));const g=ensureGraph(),r=await evaluateScan(activeSurface,config,g,resolveSeries);if(my!==scanToken)return;result=r;renderOverlay();if(typeof draw==='function')draw();}catch(e){if(my===scanToken){result=null;clearOverlay();console.error('Scan Layer:',e);if(statusEl)statusEl.textContent='Scan Layer failed: '+e.message;}}finally{if(my===scanToken)updateControl();}}
  function onSurface(){if(!activeSurface?.semanticDescriptor){currentIdentity='';config=defaultConfig();draft=clone(config);resetAnalysis();updateControl();clearOverlay();return;}const id=surfaceIdentity(activeSurface);if(id!==currentIdentity){currentIdentity=id;loadConfig();}resetAnalysis();updateControl();if(config.enabled&&config.criteria.length)setTimeout(()=>recompute(),0);else renderOverlay();}
  function install(){
    if(installed)return;if(!root.SurfaceSemanticAnalysisV030||!root.SurfaceSemanticAnalysisBrowserV030||!root.SurfaceFilterV029||typeof activateSurface!=='function'||typeof hardReset!=='function'||typeof draw!=='function'||typeof activeSurface==='undefined'){setTimeout(install,25);return;}installed=true;injectStyle();ensureOverlay();ensureControl();const baseDraw=draw,baseActivate=activateSurface,baseHardReset=hardReset;draw=function(){baseDraw();renderOverlay();};activateSurface=async function(surface,opt){const out=await baseActivate(surface,opt);onSurface();return out;};hardReset=async function(){const out=await baseHardReset();currentIdentity='';config=defaultConfig();draft=clone(config);resetAnalysis();updateControl();clearOverlay();return out;};if(activeSurface?.semanticDescriptor)onSurface();else updateControl();const v=document.querySelector('.version');if(v)v.textContent='v031';root.SurfaceScanLayerV031={version:VERSION,get config(){return clone(config||defaultConfig());},get result(){return result;},recompute};
  }
  install();
})(typeof window!=='undefined'?window:globalThis);
