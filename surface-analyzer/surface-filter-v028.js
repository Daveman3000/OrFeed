(function(root){
  'use strict';
  const VERSION='surface-filter-v028',STORE='surface-analyzer-surface-filter:v1:';
  let installed=false,fullSurface=null,selection={},draft={},lastIdentity='',suspend=false;

  const defsById=d=>Object.fromEntries((d.parameters||[]).map(p=>[p.id,p]));
  const token=v=>v==null?'':String(v);
  function valueLabel(def,i){const v=def?.values?.[i],m=def?.value_labels||{};return m[String(v)]??String(v);}
  function surfaceIdentity(surface){
    const d=surface?.semanticDescriptor||{},p=d.provenance||{};
    const sourceHash=p.source_sha256||p.source?.sha256||p.semantic_csv_sha256||p.canonical_results_sha256||'';
    if(sourceHash)return `${d.study_id||'surface'}:sha:${sourceHash}`;
    const run=[p.job_id,p.run_id,p.data_generation_id,p.backtester_build].filter(v=>v!=null&&v!=='').join('|');
    if(run)return `${d.study_id||'surface'}:run:${run}`;
    return `${d.study_id||'surface'}:file:${surface?.fileName||'surface'}|${surface?.fileSize||0}|${surface?.rows||0}x${surface?.cols||0}`;
  }
  function axisIds(surface){const l=surface?.semanticDescriptor?.layout||{};return {x:[...(l.x_parameter_order||[])],y:[...(l.y_parameter_order||[])]};}
  function initSelection(surface){
    const id=surfaceIdentity(surface);lastIdentity=id;const defs=defsById(surface.semanticDescriptor),axes=axisIds(surface),allowed=new Set([...axes.y,...axes.x]),base={};
    for(const p of surface.semanticDescriptor.parameters||[])if(allowed.has(p.id))base[p.id]=new Set((p.values||[]).map((_,i)=>i));
    let saved=null;try{saved=JSON.parse(localStorage.getItem(STORE+id)||'null');}catch{}
    if(saved)for(const [pid,vals] of Object.entries(saved)){if(!base[pid]||!Array.isArray(vals))continue;const max=defs[pid]?.values?.length||0,valid=vals.filter(i=>Number.isInteger(i)&&i>=0&&i<max);if(valid.length)base[pid]=new Set(valid);}
    selection=base;draft=cloneSelection(base);
  }
  function cloneSelection(src){const out={};for(const [k,s] of Object.entries(src))out[k]=new Set(s);return out;}
  function saveSelection(){if(!fullSurface)return;const plain={};for(const [k,s] of Object.entries(selection))plain[k]=[...s].sort((a,b)=>a-b);localStorage.setItem(STORE+surfaceIdentity(fullSurface),JSON.stringify(plain));}
  function activeFilters(surface=fullSurface){if(!surface)return false;const defs=defsById(surface.semanticDescriptor);for(const [id,s] of Object.entries(selection)){const n=defs[id]?.values?.length||0;if(n&&s.size<n)return true;}return false;}
  function passEntry(sem,ids,defs){
    for(const id of ids){const raw=sem?.[id];if(raw==null||raw==='')continue;const def=defs[id],set=selection[id];if(!def||!set)continue;const idx=(def.values||[]).findIndex(v=>token(v)===token(raw));if(idx>=0&&!set.has(idx))return false;}
    return true;
  }
  function filterSurface(source){
    if(!source?.semanticDescriptor||!activeFilters(source))return source;
    const defs=defsById(source.semanticDescriptor),axes=axisIds(source),xAxis=source.semanticAxis?.x||[],yAxis=source.semanticAxis?.y||[];
    const keepX=[],keepY=[];for(let c=0;c<xAxis.length;c++)if(passEntry(xAxis[c],axes.x,defs))keepX.push(c);for(let r=0;r<yAxis.length;r++)if(passEntry(yAxis[r],axes.y,defs))keepY.push(r);
    if(!keepX.length||!keepY.length)throw new Error('Filter removes every configuration. Keep at least one value on each axis.');
    const oldCols=source.cols,cols=keepX.length,rows=keepY.length,n=rows*cols,metrics={},params={};
    for(const [k] of Object.entries(source.metrics||{}))metrics[k]=new Float64Array(n);
    for(const [k] of Object.entries(source.semanticParameterIndices||{})){const a=new Int16Array(n);a.fill(-1);params[k]=a;}
    let p=0;for(const r of keepY)for(const c of keepX){const old=r*oldCols+c;for(const [k,a] of Object.entries(source.metrics||{}))metrics[k][p]=a[old];for(const [k,a] of Object.entries(source.semanticParameterIndices||{}))params[k][p]=a[old];p++;}
    return {...source,rows,cols,metrics,semanticParameterIndices:params,semanticAxis:{x:keepX.map(i=>xAxis[i]),y:keepY.map(i=>yAxis[i])},surfaceFilter:{active:true,sourceConfigs:source.rows*source.cols,visibleConfigs:n}};
  }
  function injectStyle(){
    if(document.getElementById('surfaceFilterV028Style'))return;const s=document.createElement('style');s.id='surfaceFilterV028Style';s.textContent=`
      .sa-filter-wrap{position:relative}.sa-filter-btn.active{box-shadow:inset 0 0 0 1px #6f91b5;color:#fff}.sa-filter-pop{display:none;position:absolute;right:0;top:38px;z-index:80;width:380px;max-width:min(92vw,380px);max-height:68vh;overflow:auto;background:#111821;border:1px solid #34404d;border-radius:10px;box-shadow:0 18px 46px #000a;padding:11px}.sa-filter-wrap.open .sa-filter-pop{display:block}.sa-filter-head{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px}.sa-filter-title{font-size:12px;font-weight:800;color:#e0e7ee}.sa-filter-actions{display:flex;gap:6px}.sa-filter-actions button{font-size:10px;padding:5px 8px}.sa-filter-axis{font-size:9px;font-weight:800;letter-spacing:.12em;color:#697785;margin:10px 0 5px}.sa-filter-param{border-top:1px solid #26313d;padding:7px 0}.sa-filter-name{font-size:10px;font-weight:750;color:#aeb9c4;margin-bottom:5px}.sa-filter-values{display:flex;flex-wrap:wrap;gap:5px 9px}.sa-filter-value{display:flex;align-items:center;gap:5px;font-size:10px;color:#c8d1da;cursor:pointer}.sa-filter-value input{margin:0}.sa-filter-note{margin-top:9px;padding-top:8px;border-top:1px solid #26313d;color:#71808f;font-size:9px;line-height:1.4}.sa-filter-error{color:#e7a0a6;margin-top:7px;font-size:9px;display:none}
    `;document.head.appendChild(s);
  }
  function ensureControl(){
    const controls=document.querySelector('.controls');if(!controls)return null;let wrap=document.getElementById('surfaceFilterControl');if(wrap)return wrap;
    wrap=document.createElement('div');wrap.id='surfaceFilterControl';wrap.className='ctrl sa-filter-wrap';wrap.innerHTML='<button class="sa-filter-btn" type="button">Filter Surface ▾</button><div class="sa-filter-pop"></div>';
    const axis=document.getElementById('axisLayerControl');controls.insertBefore(wrap,axis||controls.querySelector('.legend'));wrap.querySelector('.sa-filter-btn').addEventListener('click',e=>{e.stopPropagation();if(!fullSurface)return;draft=cloneSelection(selection);renderMenu();wrap.classList.toggle('open');});document.addEventListener('click',e=>{if(!wrap.contains(e.target))wrap.classList.remove('open');});return wrap;
  }
  function renderMenu(){
    const wrap=ensureControl();if(!wrap||!fullSurface)return;const pop=wrap.querySelector('.sa-filter-pop'),d=fullSurface.semanticDescriptor,defs=defsById(d),axes=axisIds(fullSurface);
    pop.innerHTML='<div class="sa-filter-head"><div class="sa-filter-title">Filter surface values</div><div class="sa-filter-actions"><button data-act="reset" type="button">Reset</button><button data-act="apply" type="button">Apply</button></div></div>';
    for(const axis of ['y','x']){const sec=document.createElement('div');sec.className='sa-filter-axis';sec.textContent=axis.toUpperCase();pop.appendChild(sec);for(const id of axes[axis]){const def=defs[id];if(!def||!draft[id]||!def.values?.length)continue;const row=document.createElement('div');row.className='sa-filter-param';const name=document.createElement('div');name.className='sa-filter-name';name.textContent=def.label||id;row.appendChild(name);const vals=document.createElement('div');vals.className='sa-filter-values';def.values.forEach((v,i)=>{const lab=document.createElement('label');lab.className='sa-filter-value';const cb=document.createElement('input');cb.type='checkbox';cb.checked=draft[id].has(i);cb.addEventListener('change',()=>{if(cb.checked)draft[id].add(i);else draft[id].delete(i);});lab.append(cb,document.createTextNode(valueLabel(def,i)));vals.appendChild(lab);});row.appendChild(vals);pop.appendChild(row);}}
    const err=document.createElement('div');err.className='sa-filter-error';pop.appendChild(err);const note=document.createElement('div');note.className='sa-filter-note';note.textContent='Filtering changes only the visible Performance surface. Inactive parameter states are retained. Robustness / Facet Replication use the full original surface.';pop.appendChild(note);
    pop.querySelector('[data-act="apply"]').addEventListener('click',async()=>{for(const [id,s] of Object.entries(draft))if(!s.size){err.style.display='block';err.textContent=`Keep at least one ${defs[id]?.label||id} value.`;return;}selection=cloneSelection(draft);saveSelection();wrap.classList.remove('open');await refreshPerformance();});
    pop.querySelector('[data-act="reset"]').addEventListener('click',async()=>{initSelection(fullSurface);for(const p of d.parameters||[])if(selection[p.id])selection[p.id]=new Set((p.values||[]).map((_,i)=>i));draft=cloneSelection(selection);saveSelection();wrap.classList.remove('open');await refreshPerformance();});
  }
  function updateControl(){const wrap=ensureControl();if(!wrap)return;const btn=wrap.querySelector('.sa-filter-btn');const on=activeFilters();btn.classList.toggle('active',on);btn.textContent=on?'Filter Surface •':'Filter Surface ▾';btn.disabled=!fullSurface||((typeof currentMode!=='undefined')&&currentMode!=='performance');btn.title=on?'A semantic value filter is active.':'Filter parameter values without changing the source package.';wrap.style.display=fullSurface?'':'none';}
  async function refreshPerformance(){if(!fullSurface||suspend)return;suspend=true;try{await activateSurface(fullSurface,{persist:false});}finally{suspend=false;updateControl();}}
  function install(){
    if(installed)return;if(!root.SurfaceAutoFormatV026||typeof activateSurface!=='function'||typeof hardReset!=='function'||typeof setMode!=='function'){setTimeout(install,25);return;}installed=true;injectStyle();ensureControl();
    const baseActivate=activateSurface,baseHardReset=hardReset,baseSetMode=setMode;
    activateSurface=async function(surface,opt){
      if(suspend)return baseActivate(surface,opt);
      const incomingId=surfaceIdentity(surface),knownId=fullSurface?surfaceIdentity(fullSurface):'';
      if(opt?.persist){const out=await baseActivate(surface,opt);fullSurface=activeSurface;initSelection(fullSurface);const final=activeFilters()&&currentMode==='performance'?await baseActivate(filterSurface(fullSurface),{persist:false}):out;updateControl();return final;}
      if(!fullSurface||incomingId!==knownId){fullSurface=surface;initSelection(fullSurface);}const source=(surface===activeSurface&&fullSurface)?fullSurface:surface;
      const view=currentMode==='performance'?filterSurface(source):source;const out=await baseActivate(view,opt);updateControl();return out;
    };
    setMode=async function(mode){
      if(!fullSurface||!activeFilters())return baseSetMode(mode);
      if(mode!=='performance'&&currentMode==='performance'){suspend=true;try{await baseActivate(fullSurface,{persist:false});}finally{suspend=false;}const out=await baseSetMode(mode);updateControl();return out;}
      if(mode==='performance'&&currentMode!=='performance'){const out=await baseSetMode(mode);suspend=true;try{await baseActivate(filterSurface(fullSurface),{persist:false});}finally{suspend=false;}updateControl();return out;}
      return baseSetMode(mode);
    };
    hardReset=async function(){fullSurface=null;selection={};draft={};lastIdentity='';const out=await baseHardReset();updateControl();return out;};
    if(activeSurface?.semanticDescriptor){fullSurface=activeSurface;initSelection(fullSurface);if(activeFilters()&&currentMode==='performance')setTimeout(()=>refreshPerformance(),0);}updateControl();const v=document.querySelector('.version');if(v)v.textContent='v028';root.SurfaceFilterV028={version:VERSION,filterSurface,activeFilters};
  }
  install();
})(typeof window!=='undefined'?window:globalThis);
