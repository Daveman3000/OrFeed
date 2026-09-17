const ROWS=224,COLS=250;
const METRICS=['r_per_trade','expectancy_per_contract','profit_factor','romad','max_drawdown_r','total_r'];
const DB_NAME='surface-analyzer-local',DB_VERSION=1,DB_STORE='state',ACTIVE_KEY='active-surface';
const canvas=document.getElementById('heat'),ctx=canvas.getContext('2d');
const loading=document.getElementById('loading'),hover=document.getElementById('hover'),metricSel=document.getElementById('metric'),viewSel=document.getElementById('view'),statusEl=document.getElementById('status'),metricMode=document.getElementById('metricMode'),readCopy=document.getElementById('readCopy');
const uploadBtn=document.getElementById('uploadCsv'),csvFile=document.getElementById('csvFile'),hardResetBtn=document.getElementById('hardReset'),surfaceNameEl=document.getElementById('surfaceName');
let meta,currentKey='r_per_trade',values=null,currentStats=null,currentMode='performance',lastPerformanceKey='r_per_trade',lastRobustnessKey='structural_robustness',lastPerformanceView='raw',activeSurface=null;
const cache=new Map(),statsCache=new Map();
const robustnessKeys=new Set(['structural_robustness']);
const robustnessOrder=['structural_robustness'];
const pointsThresholds=[150,175,200,225,250,275,300];
const atrThresholds=[20,25,30,35,40,45,50];
const pmCloseLabels=['London 50%','London 75%','London','Asia'];
const stopBoundaries=[6,12,18,24,36,42,48,54,88,106,124,142,178,196,214,232];
const performanceRead=`Y selects <b>market context</b>. X selects <b>trade management</b>: fixed target, pure 30-minute OTF trail, or a hybrid that sends part of the position to a fixed target while the remainder follows the independent OTF trail. Read large color regions first: horizontal bands point to robust context filters; vertical bands point to robust management choices; compact islands mean the interaction matters.`;
const robustnessRead=`The <b>same 224×250 display</b> is preserved. Robustness is calculated before display from the descriptor-resolved parameter graph: regime and facet values hard-split topology, while only legitimate ordered-parameter steps create neighbors. Screen-adjacent cells do <b>not</b> define robustness.`;

function mix(a,b,t){return a.map((v,i)=>Math.round(v+(b[i]-v)*t));}
function rgb(q){const t=q/15;return t<.5?mix([171,43,54],[58,67,79],t*2):mix([58,67,79],[32,151,86],(t-.5)*2);}
function fmt(v,d){return Number(v).toLocaleString(undefined,{minimumFractionDigits:d,maximumFractionDigits:d});}
function clamp01(v){return Math.max(0,Math.min(1,v));}
function isRobust(){return robustnessKeys.has(currentKey);}
function usingExactSurface(){return !!activeSurface;}

function normalizeBase64(text){
  let txt=text.trim().replace(/-/g,'+').replace(/_/g,'/').replace(/[^A-Za-z0-9+/]/g,'');
  if(!txt)throw new Error('empty payload');
  const rem=txt.length%4;if(rem)txt+='='.repeat(4-rem);return txt;
}
async function decodeMetricUrl(url){
  const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);
  const txt=normalizeBase64(await r.text()),bin=atob(txt),bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));
  if(typeof DecompressionStream==='undefined')throw new Error('This browser does not support DecompressionStream.');
  const ds=new DecompressionStream('deflate'),ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  const packed=new Uint8Array(ab),arr=new Uint8Array(ROWS*COLS);
  if(packed.length*2!==ROWS*COLS)throw new Error(`Expected ${ROWS*COLS/2} packed bytes, got ${packed.length}`);
  for(let i=0;i<packed.length;i++){arr[i*2]=packed[i]>>4;arr[i*2+1]=packed[i]&15;}
  return arr;
}
async function fetchTextWithFallback(path){
  const urls=[`${path}?v=008`,`https://raw.githubusercontent.com/Daveman3000/OrFeed/gh-pages/surface-analyzer/${path}?v=008`],errors=[];
  for(const url of urls){try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}catch(e){errors.push(e.message);}}
  throw new Error(errors.join(' · fallback: '));
}
const robustnessAssets={structural_robustness:'sr'};
async function decodeRobustnessHex(key){
  if(cache.has(key))return cache.get(key);
  const code=robustnessAssets[key];if(!code)throw new Error(`Unknown robustness layer ${key}`);
  let hex='';for(let i=0;i<4;i++)hex+=(await fetchTextWithFallback(`data/robustness_v008_${code}_${i}.hex`)).replace(/[^0-9a-f]/gi,'');
  if(hex.length!==ROWS*COLS)throw new Error(`${meta[key].label}: expected ${ROWS*COLS} cells, got ${hex.length}`);
  const arr=new Uint8Array(ROWS*COLS);for(let i=0;i<hex.length;i++)arr[i]=parseInt(hex[i],16);
  cache.set(key,arr);return arr;
}
async function decodeLegacyMetric(key){
  if(cache.has(key))return cache.get(key);
  const asset=key==='max_drawdown_r'?'max_drawdown_r_v006':key;
  const urls=[`data/${asset}.b64?v=008`,`https://raw.githubusercontent.com/Daveman3000/OrFeed/gh-pages/surface-analyzer/data/${asset}.b64?v=008`],errors=[];
  for(const url of urls){try{const arr=await decodeMetricUrl(url);cache.set(key,arr);return arr;}catch(e){errors.push(e.message);}}
  throw new Error(errors.join(' · fallback: '));
}
async function decodeMetric(key){
  if(robustnessKeys.has(key))return decodeRobustnessHex(key);
  if(activeSurface){
    const arr=activeSurface.metrics[key];if(!arr)throw new Error(`Uploaded CSV does not contain ${key}`);return arr;
  }
  return decodeLegacyMetric(key);
}

function openDb(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)){reject(new Error('IndexedDB is unavailable in this browser'));return;}
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE);};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));
  });
}
async function idbGetActive(){
  const db=await openDb();
  try{return await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readonly'),req=tx.objectStore(DB_STORE).get(ACTIVE_KEY);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
  finally{db.close();}
}
async function idbSetActive(surface){
  const db=await openDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).put(surface,ACTIVE_KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'));});}
  finally{db.close();}
}
async function idbClearActive(){
  const db=await openDb();
  try{await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readwrite');tx.objectStore(DB_STORE).delete(ACTIVE_KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
  finally{db.close();}
}

function parseCsv(text){
  const rows=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'){
        if(text[i+1]==='"'){field+='"';i++;}else quoted=false;
      }else field+=ch;
    }else{
      if(ch==='"')quoted=true;
      else if(ch===','){row.push(field);field='';}
      else if(ch==='\n'){row.push(field);rows.push(row);row=[];field='';}
      else if(ch!=='\r')field+=ch;
    }
  }
  if(quoted)throw new Error('CSV ends inside a quoted field');
  if(field.length||row.length){row.push(field);rows.push(row);}
  return rows;
}
function percentileSorted(sorted,p){
  if(!sorted.length)return NaN;
  const x=(sorted.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x);
  return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo);
}
function buildUploadedSurface(text,file){
  const rows=parseCsv(text);if(rows.length<2)throw new Error('CSV has no result rows');
  const header=rows[0].map(x=>x.trim()),col=Object.fromEntries(header.map((name,i)=>[name,i]));
  const required=['outer_ordinal','inner_ordinal','result_ordinal',...METRICS];
  const missing=required.filter(k=>col[k]===undefined);if(missing.length)throw new Error(`Missing required columns: ${missing.join(', ')}`);
  const dataRows=rows.slice(1).filter(r=>r.some(v=>v!==''));
  if(dataRows.length!==ROWS*COLS)throw new Error(`Expected ${ROWS*COLS} result rows, got ${dataRows.length}`);
  const inverse=new Int32Array(COLS);inverse.fill(-1);
  meta.__order__.forEach((orig,visual)=>{if(orig<0||orig>=COLS)throw new Error('Viewer X order is invalid');inverse[orig]=visual;});
  if(inverse.some(v=>v<0))throw new Error('Viewer X order is incomplete');
  const metrics=Object.fromEntries(METRICS.map(k=>[k,new Float64Array(ROWS*COLS)])),seen=new Uint8Array(ROWS*COLS);
  let jobId=null,runId=null,generationId=null,buildId=null;
  for(let n=0;n<dataRows.length;n++){
    const r=dataRows[n];
    const outer=Number(r[col.outer_ordinal]),inner=Number(r[col.inner_ordinal]),ord=Number(r[col.result_ordinal]);
    if(!Number.isInteger(outer)||outer<0||outer>=ROWS)throw new Error(`Row ${n+2}: invalid outer_ordinal ${r[col.outer_ordinal]}`);
    if(!Number.isInteger(inner)||inner<0||inner>=COLS)throw new Error(`Row ${n+2}: invalid inner_ordinal ${r[col.inner_ordinal]}`);
    if(!Number.isInteger(ord)||ord!==outer*COLS+inner)throw new Error(`Row ${n+2}: result_ordinal mismatch`);
    if(seen[ord])throw new Error(`Duplicate result_ordinal ${ord}`);seen[ord]=1;
    const visual=outer*COLS+inverse[inner];
    for(const key of METRICS){
      const v=Number(r[col[key]]);if(!Number.isFinite(v))throw new Error(`Row ${n+2}: invalid ${key}`);
      metrics[key][visual]=v;
    }
    for(const [name,setter] of [['job_id',v=>jobId=v],['run_id',v=>runId=v],['data_generation_id',v=>generationId=v],['backtester_build',v=>buildId=v]]){
      if(col[name]===undefined)continue;
      const v=r[col[name]];
      const prev=name==='job_id'?jobId:name==='run_id'?runId:name==='data_generation_id'?generationId:buildId;
      if(prev===null)setter(v);else if(v!==prev)throw new Error(`Row ${n+2}: mixed ${name} values`);
    }
  }
  if(seen.some(v=>v!==1))throw new Error('CSV does not cover every expected result ordinal');
  return {schemaVersion:1,fileName:file.name||'uploaded.csv',fileSize:file.size||text.length,loadedAt:new Date().toISOString(),rows:ROWS,cols:COLS,jobId,runId,generationId,buildId,metrics};
}
function normalizeStoredSurface(s){
  if(!s||s.rows!==ROWS||s.cols!==COLS||!s.metrics)return null;
  for(const key of METRICS){
    const arr=s.metrics[key];if(!arr||arr.length!==ROWS*COLS)return null;
    if(!(arr instanceof Float64Array))s.metrics[key]=new Float64Array(arr);
  }
  return s;
}
function setSurfaceLabel(){
  if(!surfaceNameEl)return;
  surfaceNameEl.textContent=activeSurface?`Loaded: ${activeSurface.fileName}`:'Default surface';
  surfaceNameEl.title=activeSurface?`${activeSurface.fileName} · ${ROWS*COLS.toLocaleString()} rows · persists until Hard Reset`:'Legacy default surface';
}
function updateRobustnessAvailability(){
  const b=metricMode.querySelector('button[data-mode="robustness"]');if(!b)return;
  b.disabled=!!activeSurface;b.title=activeSurface?'Robustness for uploaded CSV will be added from the canonical graph engine; old-surface robustness is hidden to prevent a mismatch.':'';
}
async function activateSurface(surface,{persist=true}={}){
  activeSurface=normalizeStoredSurface(surface);if(!activeSurface)throw new Error('Stored surface is invalid');
  if(persist)await idbSetActive(activeSurface);
  cache.clear();statsCache.clear();setSurfaceLabel();updateRobustnessAvailability();
  if(currentMode==='robustness'){currentMode='performance';for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode==='performance');readCopy.innerHTML=performanceRead;}
  setViewForMode('performance');populateMetricOptions('performance');
  if(!activeSurface.metrics?.[lastPerformanceKey]||!meta[lastPerformanceKey])lastPerformanceKey='r_per_trade';
  currentKey=lastPerformanceKey;metricSel.value=currentKey;
  await setMetric(currentKey);
}
async function hardReset(){
  loading.style.display='flex';loading.textContent='Clearing local surface…';
  await idbClearActive();activeSurface=null;cache.clear();statsCache.clear();setSurfaceLabel();updateRobustnessAvailability();
  currentMode='performance';for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode==='performance');
  setViewForMode('performance');populateMetricOptions('performance');if(!METRICS.includes(lastPerformanceKey))lastPerformanceKey='r_per_trade';currentKey=lastPerformanceKey;metricSel.value=currentKey;readCopy.innerHTML=performanceRead;
  await setMetric(currentKey);
}

function buildLegacyCdf(arr){
  const h=new Uint32Array(16),out=new Float32Array(16);for(const q of arr)h[q]++;let sum=0;
  for(let i=0;i<16;i++){sum+=h[i];out[i]=sum/arr.length;}return out;
}
function buildMidranks(arr){
  const idx=Array.from({length:arr.length},(_,i)=>i).sort((a,b)=>arr[a]-arr[b]),out=new Float32Array(arr.length),den=Math.max(1,arr.length-1);
  for(let i=0;i<idx.length;){let j=i+1;while(j<idx.length&&arr[idx[j]]===arr[idx[i]])j++;const rank=((i+j-1)/2)/den;for(let k=i;k<j;k++)out[idx[k]]=rank;i=j;}
  return out;
}
function metricStats(key,arr){
  if(statsCache.has(key))return statsCache.get(key);
  if(!usingExactSurface()){
    const stats={legacy:true,cdf:buildLegacyCdf(arr)};statsCache.set(key,stats);return stats;
  }
  const sorted=Array.from(arr).sort((a,b)=>a-b),p5=percentileSorted(sorted,.05),p95=percentileSorted(sorted,.95),span=Math.max(Math.abs(p95-p5),1e-9),lin=span/10;
  const symlog=v=>Math.sign(v)*Math.log1p(Math.abs(v)/lin);
  const stats={legacy:false,lo:p5,hi:p95,min:sorted[0],max:sorted[sorted.length-1],ranks:buildMidranks(arr),lin,logLo:symlog(p5),logHi:symlog(p95),symlog};
  statsCache.set(key,stats);return stats;
}
async function setMetric(key){
  currentKey=key;loading.style.display='flex';loading.textContent=activeSurface?'Loading local surface…':'Loading real 56k landscape…';
  try{
    values=await decodeMetric(key);currentStats=isRobust()?null:metricStats(key,values);loading.style.display='none';
    statusEl.textContent=isRobust()?`${meta[key].label} loaded · topology-derived across 56,000 tested configurations`:activeSurface?`${meta[key].label} · exact CSV values · ${activeSurface.fileName} · saved locally`:`${meta[key].label} loaded · default surface`;
    draw();
  }catch(e){loading.style.display='flex';loading.textContent='Could not load heatmap data: '+e.message;statusEl.textContent=`${meta[key].label} failed to load`;}
}
function size(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d));draw();}
function displayQ(i){
  const m=meta[currentKey];
  if(isRobust()){let z=values[i];if(m.invert)z=15-z;return z;}
  const view=viewSel.value;
  if(currentStats.legacy){
    const q=values[i];let z=view==='pct'?Math.round(currentStats.cdf[q]*15):q;if(m.invert)z=15-z;return z;
  }
  const v=values[i];let t;
  if(view==='pct')t=currentStats.ranks[i];
  else if(view==='log'){const tv=currentStats.symlog(v),span=currentStats.logHi-currentStats.logLo;t=span===0?.5:(tv-currentStats.logLo)/span;}
  else{const span=currentStats.hi-currentStats.lo;t=span===0?.5:(v-currentStats.lo)/span;}
  t=clamp01(t);if(m.invert)t=1-t;return Math.round(t*15);
}
function vline(x,sx,d,kind='minor'){ctx.beginPath();ctx.moveTo(x*sx,0);ctx.lineTo(x*sx,canvas.height);ctx.setLineDash(kind==='hard'?[]:[4*d,5*d]);ctx.strokeStyle=kind==='hard'?'rgba(244,247,250,.92)':kind==='stop'?'rgba(175,187,199,.28)':'rgba(190,200,211,.52)';ctx.lineWidth=(kind==='hard'?3:1)*d;ctx.stroke();}
function hline(y,sy,d,kind='minor'){ctx.beginPath();ctx.moveTo(0,y*sy);ctx.lineTo(canvas.width,y*sy);ctx.setLineDash(kind==='hard'?[]:kind==='sub'?[2*d,5*d]:[4*d,5*d]);ctx.strokeStyle=kind==='hard'?'rgba(244,247,250,.92)':kind==='sub'?'rgba(175,187,199,.20)':'rgba(190,200,211,.42)';ctx.lineWidth=(kind==='hard'?3:1)*d;ctx.stroke();}
function draw(){
  if(!values||!meta)return;
  const off=document.createElement('canvas');off.width=COLS;off.height=ROWS;const o=off.getContext('2d'),im=o.createImageData(COLS,ROWS);
  for(let i=0;i<values.length;i++){const c=rgb(displayQ(i)),p=i*4;im.data[p]=c[0];im.data[p+1]=c[1];im.data[p+2]=c[2];im.data[p+3]=255;}
  o.putImageData(im,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=false;ctx.drawImage(off,0,0,canvas.width,canvas.height);
  const sx=canvas.width/COLS,sy=canvas.height/ROWS,d=devicePixelRatio||1;ctx.save();
  for(let r=8;r<ROWS;r+=8){if(r===112)continue;hline(r,sy,d,r%16===0?'minor':'sub');}hline(112,sy,d,'hard');
  for(const x of stopBoundaries)vline(x,sx,d,'stop');for(const x of [30,60,65,70,160])vline(x,sx,d,[60,70].includes(x)?'hard':'minor');ctx.restore();
}
function outerInfo(row){const isAtr=row>=112,local=row%112,t=Math.floor(local/16),within=local%16,londonClose=within>=8?1:0,withinClose=within%8,pm=Math.floor(withinClose/2),entry=withinClose%2;return{mode:isAtr?'ATR':'Points',threshold:isAtr?`${atrThresholds[t]}% ATR`:`${pointsThresholds[t]} pt`,londonClose,pm,pmLabel:pmCloseLabels[pm],entry};}
function innerInfo(orig){const stop=[10,20,30,40,50][Math.floor(orig/50)],within=orig%50,trades=orig%2===0?1:2,scenario=Math.floor(within/2);let mode,allocation=null,rule=null,multiple=null;if(scenario<=5){mode='Fixed';allocation=25;rule=scenario===0?0:1;multiple=scenario===0?1:[1,1.25,1.5,1.75,2][scenario-1];}else if(scenario===6){mode='Trail';}else{mode='Hybrid';const j=scenario-7,allocIdx=Math.floor(j/6),v=j%6;allocation=[25,37.5,50][allocIdx];rule=v===0?0:1;multiple=v===0?1:[1,1.25,1.5,1.75,2][v-1];}return{stop,trades,mode,allocation,rule,multiple};}
function legacyRawApprox(q){const m=meta[currentKey];return m.lo+(m.hi-m.lo)*(q/15);}
function robustApprox(q){const m=meta[currentKey];return m.lo+(m.hi-m.lo)*(q/15);}
function setViewForMode(mode){
  if(mode==='robustness'){lastPerformanceView=viewSel.value;viewSel.innerHTML='<option value="raw">Score</option>';viewSel.value='raw';}
  else{
    viewSel.innerHTML='<option value="raw">Raw</option><option value="pct">Percentile</option>'+(activeSurface?'<option value="log">Log</option>':'');
    const allowed=activeSurface?['raw','pct','log']:['raw','pct'];viewSel.value=allowed.includes(lastPerformanceView)?lastPerformanceView:'raw';
  }
}
function populateMetricOptions(mode){metricSel.innerHTML='';const keys=mode==='robustness'?robustnessOrder:Object.keys(meta).filter(k=>!k.startsWith('__')&&!robustnessKeys.has(k)).filter(k=>activeSurface?!!activeSurface.metrics?.[k]:METRICS.includes(k));for(const k of keys){const opt=document.createElement('option');opt.value=k;opt.textContent=meta[k].label;metricSel.appendChild(opt);}}
async function setMode(mode){
  if(mode==='robustness'&&activeSurface)return;
  if(mode===currentMode)return;
  if(currentMode==='performance'){lastPerformanceKey=currentKey;lastPerformanceView=viewSel.value;}else lastRobustnessKey=currentKey;
  currentMode=mode;for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===mode);setViewForMode(mode);populateMetricOptions(mode);readCopy.innerHTML=mode==='robustness'?robustnessRead:performanceRead;
  const next=mode==='robustness'?lastRobustnessKey:lastPerformanceKey;metricSel.value=next;await setMetric(next);
}
canvas.addEventListener('mousemove',e=>{
  if(!values)return;
  const r=canvas.getBoundingClientRect(),col=Math.max(0,Math.min(COLS-1,Math.floor((e.clientX-r.left)/r.width*COLS))),row=Math.max(0,Math.min(ROWS-1,Math.floor((e.clientY-r.top)/r.height*ROWS))),idx=row*COLS+col,q=values[idx],m=meta[currentKey],o=outerInfo(row),orig=meta.__order__[col],inn=innerInfo(orig);
  const v=isRobust()?robustApprox(q):(activeSurface?q:legacyRawApprox(q));
  const pct=(!isRobust()&&activeSurface)?Math.round(currentStats.ranks[idx]*100):(!isRobust()&&currentStats.legacy)?Math.round(currentStats.cdf[q]*100):null;
  const target=inn.mode==='Trail'?'30m OTF trail':`Rule ${inn.rule} · ${inn.multiple.toFixed(2)}× London`,valueLabel=isRobust()?'Score':'Value',valueText=`${fmt(v,m.decimals)}${(!isRobust()&&viewSel.value==='pct')?` · P${pct}`:''}`;
  hover.innerHTML=`<span>Outer: <b>${row+1} / 224</b></span><span>Inner: <b>${orig+1} / 250</b></span><span>Metric: <b>${m.label}</b></span><span>Range: <b>${o.mode} · ${o.threshold}</b></span><span>London close > Asia: <b>${o.londonClose?'Yes':'No'}</b></span><span>PM close: <b>${o.pmLabel}</b></span><span>Entry location: <b>${o.entry}</b></span><span>Management: <b>${inn.mode} · ${inn.trades} trade${inn.trades===1?'':'s'}</b></span><span>Stop: <b>${inn.stop}% London</b></span><span>Allocation: <b>${inn.allocation==null?'—':inn.allocation+'%'}</b></span><span>Target: <b>${target}</b></span><span>${valueLabel}: <b>${valueText}</b></span>`;
});
metricSel.addEventListener('change',()=>{if(currentMode==='performance')lastPerformanceKey=metricSel.value;else lastRobustnessKey=metricSel.value;setMetric(metricSel.value);});
viewSel.addEventListener('change',()=>{if(currentMode==='performance')lastPerformanceView=viewSel.value;draw();});
metricMode.addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(b&&!b.disabled)setMode(b.dataset.mode);});
uploadBtn?.addEventListener('click',()=>csvFile?.click());
csvFile?.addEventListener('change',async()=>{
  const file=csvFile.files?.[0];if(!file)return;
  loading.style.display='flex';loading.textContent=`Parsing ${file.name}…`;uploadBtn.disabled=true;hardResetBtn.disabled=true;
  try{const surface=buildUploadedSurface(await file.text(),file);await activateSurface(surface,{persist:true});statusEl.textContent=`${file.name} loaded · exact values · saved locally until Hard Reset`;}
  catch(e){loading.style.display='flex';loading.textContent='Invalid CSV: '+e.message;statusEl.textContent='CSV rejected';}
  finally{uploadBtn.disabled=false;hardResetBtn.disabled=false;csvFile.value='';}
});
hardResetBtn?.addEventListener('click',async()=>{hardResetBtn.disabled=true;uploadBtn.disabled=true;try{await hardReset();}catch(e){loading.style.display='flex';loading.textContent='Hard Reset failed: '+e.message;}finally{hardResetBtn.disabled=false;uploadBtn.disabled=false;}});
addEventListener('resize',size);

(async function init(){
  try{
    meta=await fetch('metrics.json?v=008',{cache:'no-store'}).then(r=>r.json());
    try{activeSurface=normalizeStoredSurface(await idbGetActive());}catch(e){console.warn('Local surface restore unavailable:',e);}
    setSurfaceLabel();updateRobustnessAvailability();populateMetricOptions('performance');metricSel.value=currentKey;setViewForMode('performance');readCopy.innerHTML=performanceRead;size();await setMetric(currentKey);
  }catch(e){loading.textContent='Could not initialize interface: '+e.message;}
})();
