(function(root){
  'use strict';

  const VERSION='multi-variable-scan-v034';
  const SCHEMA_VERSION=1;
  const STORE='surface-analyzer-scan-layer:v1:';
  const EPS=1e-12;
  const DEFAULT_TAU=.10;
  const finite=Number.isFinite;

  function midrankPercentile(values,invert){
    const out=new Float32Array(values.length),idx=[];
    for(let i=0;i<values.length;i++){
      if(finite(values[i]))idx.push(i);else out[i]=NaN;
    }
    if(!idx.length)return out;
    idx.sort((a,b)=>values[a]-values[b]);
    const den=Math.max(1,idx.length-1);
    for(let s=0;s<idx.length;){
      let e=s+1;
      while(e<idx.length&&values[idx[e]]===values[idx[s]])e++;
      let r=((s+e-1)/2)/den;
      if(invert)r=1-r;
      for(let j=s;j<e;j++)out[idx[j]]=r*100;
      s=e;
    }
    return out;
  }

  function percentileSorted(sorted,p){
    if(!sorted.length)return NaN;
    const x=(sorted.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x);
    return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo);
  }

  function passes(v,op,t){
    if(!finite(v)||!finite(t))return false;
    return op==='<='?v<=t:v>=t;
  }

  function connectedRegions(mask,g,minCells){
    const N=mask.length,seen=new Uint8Array(N),queue=new Int32Array(N),raw=[];
    for(let i=0;i<N;i++)if(mask[i]&&!seen[i]){
      let h=0,t=0;queue[t++]=i;seen[i]=1;const cells=[];
      while(h<t){
        const u=queue[h++];cells.push(u);
        for(let e=g.offsets[u];e<g.offsets[u+1];e++){
          const v=g.neighbors[e];
          if(mask[v]&&!seen[v]){seen[v]=1;queue[t++]=v;}
        }
      }
      raw.push(cells);
    }
    const kept=raw.filter(c=>c.length>=minCells).sort((a,b)=>b.length-a.length);
    const finalMask=new Uint8Array(N),regionId=new Int32Array(N);regionId.fill(-1);
    for(let r=0;r<kept.length;r++)for(const i of kept[r]){finalMask[i]=1;regionId[i]=r;}
    return {mask:finalMask,regionId,regions:kept};
  }

  function semanticRegionSummary(cells,g){
    const signature=(ks)=>{
      const out={};
      for(const k of ks){
        const vals=new Set();
        for(const i of cells){const vi=g.paramArrays[k][i];if(vi>=0)vals.add(vi);}
        const d=g.info.defs[k],domain=d.values||d.ordered_values||[];
        out[d.id]=[...vals].map(vi=>domain[vi]);
      }
      return out;
    };
    const orderedSpan={};
    for(const k of g.info.ordered){
      let lo=Infinity,hi=-Infinity;const vals=new Set();
      for(const i of cells){const vi=g.paramArrays[k][i];if(vi<0)continue;vals.add(vi);lo=Math.min(lo,vi);hi=Math.max(hi,vi);}
      if(vals.size)orderedSpan[g.info.defs[k].id]={min_index:lo,max_index:hi,unique_values:vals.size};
    }
    return {cell_count:cells.length,regime_signature:signature(g.info.regimes),facet_signature:signature(g.info.facets),ordered_span:orderedSpan};
  }

  function robustScales(values,g){
    const scale=new Float64Array(g.hardCells.length),flat=new Uint8Array(g.hardCells.length);
    scale.fill(NaN);
    for(let h=0;h<g.hardCells.length;h++){
      const a=[];
      for(const i of g.hardCells[h])if(finite(values[i]))a.push(values[i]);
      if(!a.length)continue;
      a.sort((x,y)=>x-y);
      const p5=percentileSorted(a,.05),p95=percentileSorted(a,.95);
      const raw=Math.abs(p95-p5),range=Math.abs(a[a.length-1]-a[0]);
      const tol=EPS*Math.max(1,Math.abs(p5),Math.abs(p95),Math.abs(a[0]),Math.abs(a[a.length-1]));
      if(raw>tol)scale[h]=raw;
      else if(range>tol)scale[h]=range;
      else{scale[h]=1;flat[h]=1;}
    }
    return {scale,flat};
  }

  function regionDepth(cells,regionId,rid,g){
    const N=regionId.length,depth=new Int32Array(N);depth.fill(-1);
    const queue=new Int32Array(cells.length);let h=0,t=0;
    for(const u of cells){
      let boundary=false;
      for(let e=g.offsets[u];e<g.offsets[u+1];e++)if(regionId[g.neighbors[e]]!==rid){boundary=true;break;}
      if(boundary){depth[u]=0;queue[t++]=u;}
    }
    if(!t)return {mean_depth:null,max_depth:null,boundaryless:true};
    let sum=0,max=0;
    while(h<t){
      const u=queue[h++],d=depth[u];sum+=d;if(d>max)max=d;
      for(let e=g.offsets[u];e<g.offsets[u+1];e++){
        const v=g.neighbors[e];
        if(regionId[v]===rid&&depth[v]<0){depth[v]=d+1;queue[t++]=v;}
      }
    }
    return {mean_depth:sum/cells.length,max_depth:max,boundaryless:false};
  }

  function analyzeRegionalRobustness(surface,g,performanceMask,minCells,metricIds,invertResolver,tau=DEFAULT_TAU){
    const regional=connectedRegions(performanceMask,g,minCells);
    const uniqueMetrics=[...new Set(metricIds)].filter(k=>surface.metrics?.[k]);
    const scaleByMetric={};
    for(const metric of uniqueMetrics)scaleByMetric[metric]=robustScales(surface.metrics[metric],g);

    const summaries=[];
    for(let rid=0;rid<regional.regions.length;rid++){
      const cells=regional.regions[rid];
      let internalHalf=0,boundaryHalf=0;
      for(const u of cells){
        for(let e=g.offsets[u];e<g.offsets[u+1];e++){
          const v=g.neighbors[e];
          if(regional.regionId[v]===rid)internalHalf++;else boundaryHalf++;
        }
      }
      const totalHalf=internalHalf+boundaryHalf;
      const geometry={
        boundary_exposure:totalHalf?boundaryHalf/totalHalf:0,
        internal_half_edges:internalHalf,
        boundary_half_edges:boundaryHalf,
        ...regionDepth(cells,regional.regionId,rid,g)
      };
      const metrics={};
      for(const metric of uniqueMetrics){
        const values=surface.metrics[metric],sc=scaleByMetric[metric],invert=!!invertResolver(metric);
        let interiorSum=0,interiorN=0,similarN=0,boundaryDropNorm=0,boundaryDropRaw=0,boundaryN=0,boundaryWorse=0;
        for(const u of cells){
          const a=values[u];if(!finite(a))continue;
          const hs=g.hardIndex[u],S=sc.scale[hs],isFlat=!!sc.flat[hs];if(!finite(S))continue;
          for(let e=g.offsets[u];e<g.offsets[u+1];e++){
            const v=g.neighbors[e],b=values[v];if(!finite(b))continue;
            if(regional.regionId[v]===rid){
              if(v<=u)continue;
              const d=isFlat?0:Math.abs(a-b)/S;
              interiorSum+=d;interiorN++;if(d<=tau+1e-15)similarN++;
            }else{
              const rawDrop=Math.max(0,invert?b-a:a-b);
              boundaryDropRaw+=rawDrop;boundaryDropNorm+=isFlat?0:rawDrop/S;boundaryN++;if(rawDrop>0)boundaryWorse++;
            }
          }
        }
        metrics[metric]={
          interior_similarity:interiorN?similarN/interiorN:1,
          interior_mean_normalized_delta:interiorN?interiorSum/interiorN:0,
          interior_edges:interiorN,
          boundary_mean_normalized_drop:boundaryN?boundaryDropNorm/boundaryN:0,
          boundary_mean_raw_drop:boundaryN?boundaryDropRaw/boundaryN:0,
          boundary_worse_fraction:boundaryN?boundaryWorse/boundaryN:0,
          boundary_edges:boundaryN,
          similarity_tau:tau
        };
      }
      summaries.push({region_id:rid+1,...semanticRegionSummary(cells,g),...geometry,metrics});
    }
    return {
      definition:'performance_criteria_only',
      similarity_tau:tau,
      performance_metrics:uniqueMetrics,
      mask:regional.mask,
      regionId:regional.regionId,
      regions:summaries
    };
  }

  async function evaluateScan(surface,config,g,seriesResolver){
    const N=surface.rows*surface.cols;
    const criteria=(config.criteria||[]).filter(c=>c.enabled!==false);
    const mask=new Uint8Array(N);mask.fill(1);
    const performanceMask=new Uint8Array(N);performanceMask.fill(1);
    const resolved=[];let performanceCriteriaCount=0;
    for(const c of criteria){
      const a=await seriesResolver(c);
      if(!a||a.length!==N)throw new Error(`${c.id||c.metric}: criterion series length mismatch`);
      resolved.push({criterion:c,values:a});
      for(let i=0;i<N;i++)if(mask[i]&&!passes(a[i],c.operator,c.value))mask[i]=0;
      if(c.source==='performance'){
        performanceCriteriaCount++;
        for(let i=0;i<N;i++)if(performanceMask[i]&&!passes(a[i],c.operator,c.value))performanceMask[i]=0;
      }
    }
    const minCells=Math.max(1,Math.trunc(Number(config.region_rules?.min_cells)||1));
    const regions=connectedRegions(mask,g,minCells);
    const summaries=regions.regions.map((cells,i)=>({region_id:i+1,...semanticRegionSummary(cells,g)}));
    let passing=0;for(const v of regions.mask)passing+=v;
    return {
      mask:regions.mask,regionId:regions.regionId,regions:summaries,passingCells:passing,totalCells:N,
      criteria:resolved.map(x=>x.criterion),
      performanceMask:performanceCriteriaCount?performanceMask:null,
      performanceMetrics:[...new Set(criteria.filter(c=>c.source==='performance').map(c=>c.metric))],
      performanceCriteriaCount
    };
  }

  const Engine={VERSION,SCHEMA_VERSION,midrankPercentile,connectedRegions,analyzeRegionalRobustness,evaluateScan};
  root.SurfaceScanEngineV034=Engine;
  if(typeof module!=='undefined'&&module.exports)module.exports=Engine;
  if(typeof window==='undefined')return;

  let installed=false,currentIdentity='',config=null,draft=null,result=null,resultSurface=null;
  let graphSurface=null,graph=null,analysisCache=new Map();

  const clone=o=>JSON.parse(JSON.stringify(o));
  const defaultConfig=()=>({
    scan_schema_version:SCHEMA_VERSION,
    scan_id:'candidate_region_scan',
    criteria_mode:'all',
    criteria:[],
    region_rules:{connectivity:'semantic_ordered_graph',min_cells:1,regional_robustness:false},
    display:{dim_nonpassing:true,outline_regions:true,show_matches_only:false}
  });

  function surfaceIdentity(surface){
    const d=surface?.semanticDescriptor||{},p=d.provenance||{};
    const hash=p.source_sha256||p.source?.sha256||p.semantic_csv_sha256||p.canonical_results_sha256||'';
    if(hash)return `${d.study_id||'surface'}:sha:${hash}`;
    const run=[p.job_id,p.run_id,p.data_generation_id,p.backtester_build].filter(v=>v!=null&&v!=='').join('|');
    if(run)return `${d.study_id||'surface'}:run:${run}`;
    return `${d.study_id||'surface'}:file:${surface?.fileName||'surface'}|${surface?.fileSize||0}`;
  }

  function storageKey(){return STORE+currentIdentity;}
  function loadConfig(){
    config=defaultConfig();
    try{
      const x=JSON.parse(localStorage.getItem(storageKey())||'null');
      if(x?.scan_schema_version===SCHEMA_VERSION){
        config={...config,...x,region_rules:{...config.region_rules,...x.region_rules},display:{...config.display,...x.display},criteria:Array.isArray(x.criteria)?x.criteria:[]};
      }
    }catch{}
    draft=clone(config);
  }
  function saveConfig(){try{localStorage.setItem(storageKey(),JSON.stringify(config));}catch{}}

  function performanceMetrics(){
    const declared=activeSurface?.semanticDescriptor?.results?.metrics||[];
    const keys=declared.length?declared:Object.keys(activeSurface?.metrics||{});
    return keys.map(x=>typeof x==='string'?x:x?.id).filter(k=>k&&activeSurface?.metrics?.[k]);
  }
  function driverMetrics(){
    const all=root.SurfaceSemanticAnalysisV030?.DRIVER_METRICS||[];
    return all.filter(k=>activeSurface?.metrics?.[k]);
  }
  function label(k){
    return (typeof meta!=='undefined'&&meta?.[k]?.label)||String(k).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
  }
  function invertMetric(k){return !!(typeof meta!=='undefined'&&meta?.[k]?.invert);}
  function defaultCriterion(){
    const metric=performanceMetrics()[0]||'r_per_trade';
    return {id:`criterion_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,enabled:true,source:'performance',metric,basis:'raw',operator:invertMetric(metric)?'<=':'>=',value:null};
  }
  function normalizeCriterion(c){
    if(c.source!=='performance'){
      c.basis='score';
      if(c.operator!=='<='&&c.operator!=='>=')c.operator='>=';
    }else if(c.basis!=='percentile')c.basis='raw';
    return c;
  }

  function clearCaches(){graphSurface=null;graph=null;analysisCache=new Map();}
  function ensureGraph(){
    if(graphSurface===activeSurface&&graph)return graph;
    graph=root.SurfaceSemanticAnalysisV030.buildTopology(activeSurface);
    graphSurface=activeSurface;
    return graph;
  }
  function scoreSeries(kind,metric){
    const key=`${kind}:${metric}`;
    if(graphSurface!==activeSurface){clearCaches();}
    if(analysisCache.has(key))return analysisCache.get(key);
    const src=activeSurface?.metrics?.[metric];
    if(!src)throw new Error(`Surface does not contain ${metric}`);
    const g=ensureGraph();
    const a=kind==='robustness'
      ?root.SurfaceSemanticAnalysisV030.computeSR(src,g).structural_robustness
      :root.SurfaceSemanticAnalysisV030.computeFR(src,g).facet_replication;
    analysisCache.set(key,a);
    return a;
  }
  async function resolveSeries(c){
    if(c.source==='performance'){
      const raw=activeSurface?.metrics?.[c.metric];
      if(!raw)throw new Error(`Surface does not contain ${c.metric}`);
      return c.basis==='percentile'?midrankPercentile(raw,invertMetric(c.metric)):raw;
    }
    if(c.source==='structural_robustness')return scoreSeries('robustness',c.metric);
    if(c.source==='facet_replication')return scoreSeries('facet',c.metric);
    throw new Error(`Unsupported scan source ${c.source}`);
  }

  function injectStyle(){
    if(document.getElementById('scanLayerV034Style'))return;
    const s=document.createElement('style');s.id='scanLayerV034Style';s.textContent=`
      .sa-scan-wrap{position:relative}.sa-scan-btn.active{box-shadow:inset 0 0 0 1px #8ba7c3;color:#fff}.sa-scan-pop{display:none;position:absolute;right:0;top:38px;z-index:95;width:720px;max-width:min(96vw,720px);max-height:74vh;overflow:auto;background:#111821;border:1px solid #34404d;border-radius:10px;box-shadow:0 18px 46px #000a;padding:12px}.sa-scan-wrap.open .sa-scan-pop{display:block}.sa-scan-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:7px}.sa-scan-title{font-size:12px;font-weight:800;color:#e0e7ee}.sa-scan-actions{display:flex;gap:6px}.sa-scan-actions button,.sa-scan-add{font-size:10px;padding:5px 8px}.sa-scan-help{color:#8e9aa7;font-size:10px;line-height:1.4;margin:0 0 10px}.sa-scan-section{font-size:9px;font-weight:800;letter-spacing:.12em;color:#697785;margin:10px 0 5px}.sa-scan-columns,.sa-scan-row{display:grid;grid-template-columns:120px minmax(170px,1fr) 92px 62px 92px 28px;gap:6px;align-items:center}.sa-scan-columns{padding:0 0 4px;color:#697785;font-size:8px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}.sa-scan-row{padding:5px 0;border-top:1px solid #26313d}.sa-scan-row select,.sa-scan-row input[type=number],.sa-scan-region input{width:100%;background:#0d141c;color:#e7edf3;border:1px solid #34404d;border-radius:5px;padding:5px 6px;font:inherit;font-size:10px}.sa-scan-row button{border:0;background:transparent;color:#82909d;font-size:15px;cursor:pointer}.sa-scan-row button:hover{color:#e7a0a6}.sa-scan-add{margin-top:7px;border:0;border-radius:6px;background:#26313d;color:#eef3f7;font-weight:700;cursor:pointer}.sa-scan-region{display:grid;grid-template-columns:140px 90px 1fr;gap:8px;align-items:center;font-size:10px;color:#b8c3cd}.sa-scan-display{display:flex;flex-wrap:wrap;gap:8px 15px;margin-top:7px;font-size:10px;color:#b8c3cd}.sa-scan-display label{cursor:pointer}.sa-scan-display label.disabled{opacity:.45;cursor:default}.sa-scan-note,.sa-scan-summary,.sa-scan-regional{margin-top:9px;padding-top:8px;border-top:1px solid #26313d;color:#71808f;font-size:9px;line-height:1.45}.sa-scan-summary,.sa-scan-regional{color:#a9b6c2}.sa-scan-regional b{color:#e0e7ee}.sa-scan-error{display:none;color:#e7a0a6;margin-top:7px;font-size:9px}.sa-scan-overlay{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;pointer-events:none!important;border-radius:5px;background:transparent!important;cursor:default!important;image-rendering:pixelated}.sa-scan-actions button:disabled{opacity:.4;cursor:default}
      @media(max-width:760px){.sa-scan-columns{display:none}.sa-scan-row{grid-template-columns:1fr 1fr}.sa-scan-pop{right:-40px}}
    `;document.head.appendChild(s);
  }

  function ensureOverlay(){
    const wrap=document.querySelector('.canvaswrap');if(!wrap)return null;
    let o=document.getElementById('scanLayerOverlay');
    if(!o){o=document.createElement('canvas');o.id='scanLayerOverlay';o.className='sa-scan-overlay';wrap.appendChild(o);}
    return o;
  }
  function clearOverlay(){
    const o=ensureOverlay();if(!o)return;
    const c=o.getContext('2d');c.clearRect(0,0,o.width,o.height);
  }
  function currentDriverMetric(){
    const raw=document.getElementById('metric')?.value||'';
    return raw.replace(/^(sr|fr):/,'');
  }
  function regionOutlineAlpha(regional,rid){
    const r=regional?.regions?.[rid];if(!r)return 210;
    const preferred=currentDriverMetric(),fallback=regional.performance_metrics?.[0];
    const m=r.metrics?.[preferred]||r.metrics?.[fallback];
    const s=m?.interior_similarity;
    return finite(s)?Math.round(95+160*Math.min(1,Math.max(0,s))):190;
  }
  function renderOverlay(){
    const o=ensureOverlay();if(!o)return;
    if(!result||resultSurface!==activeSurface||result.totalCells!==activeSurface?.rows*activeSurface?.cols){clearOverlay();return;}
    const rows=activeSurface.rows,cols=activeSurface.cols;
    if(o.width!==cols)o.width=cols;if(o.height!==rows)o.height=rows;
    const c=o.getContext('2d'),im=c.createImageData(cols,rows),mask=result.mask;
    const regional=result.regionalRobustness||null;
    const outlineMask=regional?.mask||mask,rids=regional?.regionId||result.regionId;
    const showOnly=!!config.display?.show_matches_only,dim=!!config.display?.dim_nonpassing,outline=!!config.display?.outline_regions;
    for(let i=0;i<mask.length;i++){
      const p=i*4;
      if(!mask[i]&&(showOnly||dim)){
        im.data[p]=4;im.data[p+1]=7;im.data[p+2]=10;im.data[p+3]=showOnly?238:158;
      }
      if(outline&&outlineMask[i]){
        const r=Math.floor(i/cols),col=i-r*cols,id=rids[i];
        const edge=col===0||col===cols-1||r===0||r===rows-1||(col>0&&rids[i-1]!==id)||(col+1<cols&&rids[i+1]!==id)||(r>0&&rids[i-cols]!==id)||(r+1<rows&&rids[i+cols]!==id);
        if(edge){
          const a=regional?regionOutlineAlpha(regional,id):235;
          im.data[p]=224;im.data[p+1]=234;im.data[p+2]=244;im.data[p+3]=a;
        }
      }
    }
    c.clearRect(0,0,cols,rows);c.putImageData(im,0,0);
  }

  function clearActive(){result=null;resultSurface=null;clearOverlay();updateControl();if(document.getElementById('scanLayerControl')?.classList.contains('open'))renderMenu(false);}

  function ensureControl(){
    const controls=document.querySelector('.controls');if(!controls)return null;
    let wrap=document.getElementById('scanLayerControl');if(wrap)return wrap;
    wrap=document.createElement('div');wrap.id='scanLayerControl';wrap.className='ctrl sa-scan-wrap';
    wrap.innerHTML='<button class="sa-scan-btn" type="button">Scan Layer ▾</button><div class="sa-scan-pop"></div>';
    const axis=document.getElementById('axisLayerControl');controls.insertBefore(wrap,axis||controls.querySelector('.legend'));
    const btn=wrap.querySelector('.sa-scan-btn');
    btn.addEventListener('click',e=>{
      e.stopPropagation();if(!activeSurface?.semanticDescriptor)return;
      const id=surfaceIdentity(activeSurface);if(id!==currentIdentity){currentIdentity=id;loadConfig();clearCaches();clearActive();}
      draft=clone(config||defaultConfig());if(!draft.criteria.length)draft.criteria.push(defaultCriterion());
      renderMenu(false);wrap.classList.toggle('open');
    });
    wrap.querySelector('.sa-scan-pop').addEventListener('click',e=>e.stopPropagation());
    document.addEventListener('click',e=>{if(!wrap.contains(e.target))wrap.classList.remove('open');});
    return wrap;
  }

  function option(value,text,selected){const o=document.createElement('option');o.value=value;o.textContent=text;o.selected=selected;return o;}

  function renderCriterion(row,c,index){
    const sources=[['performance','Performance'],['structural_robustness','Structural Robustness'],['facet_replication','Facet Replication']];
    const src=document.createElement('select');for(const [v,t] of sources)src.appendChild(option(v,t,c.source===v));
    const met=document.createElement('select'),basis=document.createElement('select'),op=document.createElement('select'),val=document.createElement('input'),del=document.createElement('button');
    val.type='number';val.step='any';val.placeholder='threshold';val.value=c.value==null?'':String(c.value);del.type='button';del.textContent='×';
    const fillMetrics=()=>{
      met.innerHTML='';const ms=c.source==='performance'?performanceMetrics():driverMetrics();
      for(const k of ms)met.appendChild(option(k,label(k),c.metric===k));
      if(!ms.includes(c.metric))c.metric=ms[0]||'';met.value=c.metric;
    };
    const fillBasis=()=>{
      basis.innerHTML='';
      if(c.source==='performance'){basis.disabled=false;basis.appendChild(option('raw','Raw',c.basis==='raw'));basis.appendChild(option('percentile','Percentile',c.basis==='percentile'));}
      else{c.basis='score';basis.disabled=true;basis.appendChild(option('score','Score',true));}
    };
    const fillOp=()=>{op.innerHTML='';op.appendChild(option('>=','≥',c.operator==='>='));op.appendChild(option('<=','≤',c.operator==='<='));};
    fillMetrics();fillBasis();fillOp();
    src.addEventListener('change',e=>{e.stopPropagation();c.source=src.value;if(c.source==='performance'){c.metric=performanceMetrics()[0]||'';c.basis='raw';c.operator=invertMetric(c.metric)?'<=':'>=';}else{c.metric=driverMetrics()[0]||'';c.basis='score';c.operator='>=';}renderMenu(false);});
    met.addEventListener('change',()=>{c.metric=met.value;if(c.source==='performance'&&c.basis==='raw')c.operator=invertMetric(c.metric)?'<=':'>=';renderMenu(false);});
    basis.addEventListener('change',()=>{c.basis=basis.value;c.operator=c.basis==='percentile'?'>=':(invertMetric(c.metric)?'<=':'>=');renderMenu(false);});
    op.addEventListener('change',()=>c.operator=op.value);
    val.addEventListener('input',()=>c.value=val.value===''?null:Number(val.value));
    del.addEventListener('click',e=>{e.stopPropagation();draft.criteria.splice(index,1);renderMenu(false);});
    row.append(src,met,basis,op,val,del);
  }

  function regionalSummaryElement(){
    if(!result?.regionalRobustness?.regions?.length)return null;
    const rr=result.regionalRobustness,r=rr.regions[0],preferred=currentDriverMetric(),metric=r.metrics?.[preferred]?preferred:rr.performance_metrics?.[0],m=r.metrics?.[metric];
    const d=document.createElement('div');d.className='sa-scan-regional';
    const depth=r.boundaryless?'∞':finite(r.mean_depth)?r.mean_depth.toFixed(1):'—';
    const sim=m&&finite(m.interior_similarity)?`${(m.interior_similarity*100).toFixed(0)}%`:'—';
    const drop=m&&finite(m.boundary_mean_normalized_drop)?`${m.boundary_mean_normalized_drop.toFixed(2)}S`:'—';
    d.innerHTML=`<b>Regional Robustness</b> · ${rr.regions.length.toLocaleString()} performance region${rr.regions.length===1?'':'s'} · largest ${r.cell_count.toLocaleString()} cells<br>${label(metric)} · interior similarity ${sim} · boundary exposure ${(r.boundary_exposure*100).toFixed(0)}% · mean depth ${depth} · boundary drop ${drop}`;
    d.title='Interior similarity = share of internal semantic neighbor edges within 10% of the full filtered hard-surface scale. Boundary drop is normalized by that same scale.';
    return d;
  }

  function renderMenu(seedIfEmpty=true){
    const wrap=ensureControl();if(!wrap||!activeSurface?.semanticDescriptor)return;
    if(seedIfEmpty&&!draft.criteria.length)draft.criteria.push(defaultCriterion());
    const pop=wrap.querySelector('.sa-scan-pop');pop.innerHTML='';
    const head=document.createElement('div');head.className='sa-scan-head';
    const title=document.createElement('div');title.className='sa-scan-title';title.textContent='Multi-variable scan';
    const actions=document.createElement('div');actions.className='sa-scan-actions';
    const clear=document.createElement('button');clear.type='button';clear.textContent='Clear Active';clear.disabled=!result;
    const reset=document.createElement('button');reset.type='button';reset.textContent='Reset';
    const apply=document.createElement('button');apply.type='button';apply.textContent='Apply';
    actions.append(clear,reset,apply);head.append(title,actions);pop.appendChild(head);
    const help=document.createElement('div');help.className='sa-scan-help';help.textContent='Keep configurations that pass every rule below. Apply runs the scan and activates the overlay.';pop.appendChild(help);
    const sec=document.createElement('div');sec.className='sa-scan-section';sec.textContent='MATCH ALL RULES';pop.appendChild(sec);
    if(draft.criteria.length){
      const cols=document.createElement('div');cols.className='sa-scan-columns';
      for(const t of ['Source','Metric','Basis','Rule','Threshold','']){const s=document.createElement('span');s.textContent=t;cols.appendChild(s);}pop.appendChild(cols);
    }
    draft.criteria.forEach((c,i)=>{normalizeCriterion(c);const row=document.createElement('div');row.className='sa-scan-row';renderCriterion(row,c,i);pop.appendChild(row);});
    const add=document.createElement('button');add.type='button';add.className='sa-scan-add';add.textContent='+ Add criterion';
    add.addEventListener('click',e=>{e.stopPropagation();draft.criteria.push(defaultCriterion());renderMenu(false);});pop.appendChild(add);

    const rsec=document.createElement('div');rsec.className='sa-scan-section';rsec.textContent='REGION';pop.appendChild(rsec);
    const rr=document.createElement('div');rr.className='sa-scan-region';const rlab=document.createElement('span');rlab.textContent='Minimum region cells';
    const min=document.createElement('input');min.type='number';min.min='1';min.step='1';min.value=String(draft.region_rules?.min_cells||1);min.addEventListener('input',()=>{draft.region_rules.min_cells=Math.max(1,Math.trunc(Number(min.value)||1));});
    rr.append(rlab,min,document.createTextNode('Semantic graph connectivity'));pop.appendChild(rr);

    const dsec=document.createElement('div');dsec.className='sa-scan-section';dsec.textContent='DISPLAY';pop.appendChild(dsec);
    const disp=document.createElement('div');disp.className='sa-scan-display';
    for(const [key,text] of [['dim_nonpassing','Dim failures'],['outline_regions','Outline regions'],['show_matches_only','Show matches only']]){
      const lab=document.createElement('label'),cb=document.createElement('input');cb.type='checkbox';cb.checked=!!draft.display[key];cb.addEventListener('change',()=>draft.display[key]=cb.checked);lab.append(cb,document.createTextNode(' '+text));disp.appendChild(lab);
    }
    const hasPerformance=draft.criteria.some(c=>c.enabled!==false&&c.source==='performance');
    const rlab2=document.createElement('label'),rcb=document.createElement('input');rcb.type='checkbox';rcb.checked=!!draft.region_rules.regional_robustness;rcb.disabled=!hasPerformance;rlab2.classList.toggle('disabled',!hasPerformance);
    rcb.addEventListener('change',()=>draft.region_rules.regional_robustness=rcb.checked);rlab2.append(rcb,document.createTextNode(' Run Regional Robustness'));disp.appendChild(rlab2);
    pop.appendChild(disp);
    const err=document.createElement('div');err.className='sa-scan-error';pop.appendChild(err);
    const sum=document.createElement('div');sum.className='sa-scan-summary';sum.textContent=result?`${result.passingCells.toLocaleString()} / ${result.totalCells.toLocaleString()} cells · ${result.regions.length.toLocaleString()} semantic regions${result.regions.length?` · largest ${result.regions[0].cell_count.toLocaleString()} cells`:''}`:'No active scan result.';pop.appendChild(sum);
    const reg=regionalSummaryElement();if(reg)pop.appendChild(reg);
    const note=document.createElement('div');note.className='sa-scan-note';note.textContent='Clear Active removes only the current overlay/result and keeps these rules. Reset clears the saved scan setup. Regional Robustness uses Performance rules only to define acceptable regions; SR/FR remain unconditional and are never fed back into that region definition.';pop.appendChild(note);

    clear.addEventListener('click',e=>{e.stopPropagation();clearActive();});
    reset.addEventListener('click',e=>{e.stopPropagation();config=defaultConfig();draft=clone(config);saveConfig();clearActive();draft.criteria.push(defaultCriterion());renderMenu(false);});
    apply.addEventListener('click',async e=>{
      e.stopPropagation();
      try{
        if(!draft.criteria.length)throw new Error('Add at least one criterion.');
        for(const c of draft.criteria){
          if(!c.metric)throw new Error('Each criterion needs a metric.');
          if(c.value==null||!finite(Number(c.value)))throw new Error('Each criterion needs a numeric threshold.');
          c.value=Number(c.value);
        }
        if(draft.region_rules.regional_robustness&&!draft.criteria.some(c=>c.enabled!==false&&c.source==='performance'))throw new Error('Regional Robustness requires at least one Performance criterion.');
        config=clone(draft);saveConfig();await runScan();wrap.classList.remove('open');
      }catch(ex){err.style.display='block';err.textContent=ex.message;}
    });
  }

  function updateControl(){
    const wrap=ensureControl();if(!wrap)return;
    const b=wrap.querySelector('.sa-scan-btn');
    const ok=!!activeSurface?.semanticDescriptor&&!!root.SurfaceSemanticAnalysisV030;
    b.disabled=!ok;wrap.style.display=activeSurface?.semanticDescriptor?'':'none';
    b.classList.toggle('active',!!result);b.textContent=result?'Scan Layer •':'Scan Layer ▾';
    b.title=result?`${result.passingCells.toLocaleString()} matching cells in ${result.regions.length.toLocaleString()} semantic regions`:'Multi-variable performance + robustness scan';
  }

  async function runScan(){
    if(!activeSurface?.semanticDescriptor)throw new Error('No semantic surface loaded.');
    const surface=activeSurface;
    const button=ensureControl()?.querySelector('.sa-scan-btn');
    if(button){button.disabled=true;button.textContent='Scanning…';}
    await new Promise(r=>setTimeout(r,0));
    const g=ensureGraph();
    const r=await evaluateScan(surface,config,g,resolveSeries);
    if(config.region_rules?.regional_robustness){
      if(!r.performanceMask)throw new Error('Regional Robustness requires at least one Performance criterion.');
      r.regionalRobustness=analyzeRegionalRobustness(surface,g,r.performanceMask,Math.max(1,Math.trunc(Number(config.region_rules?.min_cells)||1)),r.performanceMetrics,invertMetric,root.SurfaceSemanticAnalysisV030?.TAU||DEFAULT_TAU);
    }
    delete r.performanceMask;
    if(activeSurface!==surface)throw new Error('Surface changed while scan was running. Apply again.');
    result=r;resultSurface=surface;renderOverlay();updateControl();
  }

  function syncSurface(){
    const surface=activeSurface;
    if(!surface?.semanticDescriptor){
      if(currentIdentity||result){currentIdentity='';config=defaultConfig();draft=clone(config);clearCaches();clearActive();}
      updateControl();return;
    }
    const id=surfaceIdentity(surface);
    if(id!==currentIdentity){currentIdentity=id;loadConfig();clearCaches();clearActive();}
    if(result&&resultSurface!==surface){clearActive();clearCaches();}
    updateControl();
  }

  function install(){
    if(installed)return;
    if(!root.SurfaceSemanticAnalysisV030||!root.SurfaceFilterV029||!document.getElementById('axisLayerControl')||typeof activeSurface==='undefined'){setTimeout(install,50);return;}
    installed=true;injectStyle();ensureOverlay();ensureControl();syncSurface();
    setInterval(syncSurface,500);
    document.getElementById('metric')?.addEventListener('change',()=>setTimeout(renderOverlay,0));
    document.getElementById('metricMode')?.addEventListener('click',()=>setTimeout(renderOverlay,0));
    const v=document.querySelector('.version');if(v)v.textContent='v034';
    root.SurfaceScanLayerV034={version:VERSION,get config(){return clone(config||defaultConfig());},get result(){return result;},clearActive,runScan};
  }

  install();
})(typeof window!=='undefined'?window:globalThis);
