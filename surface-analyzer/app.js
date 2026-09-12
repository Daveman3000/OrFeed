const ROWS=224,COLS=250;
const canvas=document.getElementById('heat'),ctx=canvas.getContext('2d');
const loading=document.getElementById('loading'),hover=document.getElementById('hover'),metricSel=document.getElementById('metric'),viewSel=document.getElementById('view'),statusEl=document.getElementById('status'),metricMode=document.getElementById('metricMode'),readCopy=document.getElementById('readCopy');
let meta,currentKey='r_per_trade',values=null,currentStats=null,currentMode='performance',lastPerformanceKey='r_per_trade',lastRobustnessKey='structural_robustness',lastPerformanceView='raw',surfaceData=null,surfacePromise=null;
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
function align4(n){return (n+3)&~3;}
function isRobust(){return robustnessKeys.has(currentKey);}
function decodeVarintHDelta(bytes,start,byteLength,length,scale){
  const end=start+byteLength,out=new Float64Array(length);let pos=start,i=0;
  while(pos<end&&i<length){
    let u=0,mul=1,b;
    do{b=bytes[pos++];u+=(b&127)*mul;mul*=128;if(pos>end)throw new Error('Truncated varint payload');}while(b&128);
    const d=(u&1)?-((u+1)/2):(u/2),col=i%COLS,prev=col===0?0:Math.round(out[i-1]*scale),x=prev+d;
    out[i]=x/scale;i++;
  }
  if(i!==length||pos!==end)throw new Error(`Varint decode mismatch: ${i}/${length}, ${pos-start}/${byteLength} bytes`);
  return out;
}

async function loadSurfacePackage(){
  if(surfaceData)return surfaceData;
  if(surfacePromise)return surfacePromise;
  surfacePromise=(async()=>{
    const manifestUrl=new URL('surfaces/manifest.json',location.href);
    const manifestResp=await fetch(manifestUrl,{cache:'no-store'});
    if(!manifestResp.ok)throw new Error(`Surface manifest HTTP ${manifestResp.status}`);
    const manifest=await manifestResp.json();
    const entry=(manifest.surfaces||[]).find(x=>x.id===manifest.defaultSurface)||manifest.surfaces?.[0];
    if(!entry)throw new Error('Surface manifest contains no surfaces');
    const packageUrl=new URL(entry.package,manifestUrl);
    const r=await fetch(packageUrl,{cache:'no-store'});
    if(!r.ok)throw new Error(`Surface package HTTP ${r.status}`);
    if(typeof DecompressionStream==='undefined')throw new Error('This browser does not support DecompressionStream.');
    const ab=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const bytes=new Uint8Array(ab);
    const magic=new TextDecoder().decode(bytes.subarray(0,8));
    if(magic!=='SURFv001')throw new Error(`Unknown surface package ${magic}`);
    const dv=new DataView(ab);
    const metaLen=dv.getUint32(8,true);
    const packageMeta=JSON.parse(new TextDecoder().decode(bytes.subarray(12,12+metaLen)));
    if(packageMeta.schemaVersion!==1)throw new Error(`Unsupported surface schema ${packageMeta.schemaVersion}`);
    if(packageMeta.rows!==ROWS||packageMeta.cols!==COLS)throw new Error(`Expected ${ROWS}×${COLS}, got ${packageMeta.rows}×${packageMeta.cols}`);
    if(!Array.isArray(packageMeta.order)||packageMeta.order.length!==COLS)throw new Error('Surface package order is invalid');
    if(meta?.__order__&&packageMeta.order.some((v,i)=>v!==meta.__order__[i]))throw new Error('Surface package X order does not match viewer order');
    const dataStart=12+metaLen,arrays={};
    for(const def of packageMeta.arrays||[]){
      if(def.length!==ROWS*COLS)throw new Error(`${def.name}: expected ${ROWS*COLS} values, got ${def.length}`);
      if(def.encoding!=='zigzag-varint-hdelta-v1')throw new Error(`Unsupported array encoding ${def.encoding}`);
      arrays[def.name]=decodeVarintHDelta(bytes,dataStart+def.offset,def.byteLength,def.length,Number(def.scale)||1);
    }
    surfaceData={manifest,entry,meta:packageMeta,arrays};
    return surfaceData;
  })();
  try{return await surfacePromise;}catch(e){surfacePromise=null;throw e;}
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
async function decodeMetric(key){
  if(cache.has(key))return cache.get(key);
  if(robustnessKeys.has(key))return decodeRobustnessHex(key);
  const surface=await loadSurfacePackage(),arr=surface.arrays[key];
  if(!arr)throw new Error(`Surface package does not contain ${key}`);
  cache.set(key,arr);return arr;
}

function buildMidranks(arr){
  const idx=Array.from({length:arr.length},(_,i)=>i).sort((a,b)=>arr[a]-arr[b]);
  const out=new Float32Array(arr.length),den=Math.max(1,arr.length-1);
  for(let i=0;i<idx.length;){
    let j=i+1;while(j<idx.length&&arr[idx[j]]===arr[idx[i]])j++;
    const rank=((i+j-1)/2)/den;
    for(let k=i;k<j;k++)out[idx[k]]=rank;
    i=j;
  }
  return out;
}
function metricStats(key,arr){
  if(statsCache.has(key))return statsCache.get(key);
  const pm=surfaceData.meta.metrics[key];
  if(!pm)throw new Error(`Package metadata missing ${key}`);
  const span=Math.max(Math.abs(pm.p95-pm.p5),1e-9),lin=span/10;
  const symlog=v=>Math.sign(v)*Math.log1p(Math.abs(v)/lin);
  const stats={lo:pm.p5,hi:pm.p95,min:pm.min,max:pm.max,ranks:buildMidranks(arr),lin,logLo:symlog(pm.p5),logHi:symlog(pm.p95),symlog};
  statsCache.set(key,stats);return stats;
}
async function setMetric(key){
  currentKey=key;loading.style.display='flex';loading.textContent='Loading real 56k landscape…';
  try{
    values=await decodeMetric(key);
    currentStats=isRobust()?null:metricStats(key,values);
    loading.style.display='none';
    statusEl.textContent=isRobust()?`${meta[key].label} loaded · topology-derived across 56,000 tested configurations`:`${meta[key].label} loaded · exact values · 56,000 tested configurations`;
    draw();
  }catch(e){loading.style.display='flex';loading.textContent='Could not load heatmap data: '+e.message;statusEl.textContent=`${meta[key].label} failed to load`;}
}
function size(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d));draw();}
function displayQ(i){
  const m=meta[currentKey];
  if(isRobust()){
    let z=values[i];if(m.invert)z=15-z;return z;
  }
  const v=values[i],view=viewSel.value;let t;
  if(view==='pct')t=currentStats.ranks[i];
  else if(view==='log'){
    const tv=currentStats.symlog(v),span=currentStats.logHi-currentStats.logLo;
    t=span===0?.5:(tv-currentStats.logLo)/span;
  }else{
    const span=currentStats.hi-currentStats.lo;t=span===0?.5:(v-currentStats.lo)/span;
  }
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
function robustApprox(q){const m=meta[currentKey];return m.lo+(m.hi-m.lo)*(q/15);}
function setViewForMode(mode){
  if(mode==='robustness'){lastPerformanceView=viewSel.value;viewSel.innerHTML='<option value="raw">Score</option>';viewSel.value='raw';}
  else{viewSel.innerHTML='<option value="raw">Raw</option><option value="pct">Percentile</option><option value="log">Log</option>';viewSel.value=['raw','pct','log'].includes(lastPerformanceView)?lastPerformanceView:'raw';}
}
function populateMetricOptions(mode){metricSel.innerHTML='';const keys=mode==='robustness'?robustnessOrder:Object.keys(meta).filter(k=>!k.startsWith('__')&&!robustnessKeys.has(k));for(const k of keys){const opt=document.createElement('option');opt.value=k;opt.textContent=meta[k].label;metricSel.appendChild(opt);}}
async function setMode(mode){if(mode===currentMode)return;if(currentMode==='performance'){lastPerformanceKey=currentKey;lastPerformanceView=viewSel.value;}else lastRobustnessKey=currentKey;currentMode=mode;for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===mode);setViewForMode(mode);populateMetricOptions(mode);readCopy.innerHTML=mode==='robustness'?robustnessRead:performanceRead;const next=mode==='robustness'?lastRobustnessKey:lastPerformanceKey;metricSel.value=next;await setMetric(next);}
canvas.addEventListener('mousemove',e=>{
  if(!values)return;
  const r=canvas.getBoundingClientRect(),col=Math.max(0,Math.min(COLS-1,Math.floor((e.clientX-r.left)/r.width*COLS))),row=Math.max(0,Math.min(ROWS-1,Math.floor((e.clientY-r.top)/r.height*ROWS))),idx=row*COLS+col,q=values[idx],m=meta[currentKey],o=outerInfo(row),orig=meta.__order__[col],inn=innerInfo(orig),v=isRobust()?robustApprox(q):q,pct=isRobust()?null:Math.round(currentStats.ranks[idx]*100),target=inn.mode==='Trail'?'30m OTF trail':`Rule ${inn.rule} · ${inn.multiple.toFixed(2)}× London`,valueLabel=isRobust()?'Score':'Value',valueText=`${fmt(v,m.decimals)}${(!isRobust()&&viewSel.value==='pct')?` · P${pct}`:''}`;
  hover.innerHTML=`<span>Outer: <b>${row+1} / 224</b></span><span>Inner: <b>${orig+1} / 250</b></span><span>Metric: <b>${m.label}</b></span><span>Range: <b>${o.mode} · ${o.threshold}</b></span><span>London close > Asia: <b>${o.londonClose?'Yes':'No'}</b></span><span>PM close: <b>${o.pmLabel}</b></span><span>Entry location: <b>${o.entry}</b></span><span>Management: <b>${inn.mode} · ${inn.trades} trade${inn.trades===1?'':'s'}</b></span><span>Stop: <b>${inn.stop}% London</b></span><span>Allocation: <b>${inn.allocation==null?'—':inn.allocation+'%'}</b></span><span>Target: <b>${target}</b></span><span>${valueLabel}: <b>${valueText}</b></span>`;
});
metricSel.addEventListener('change',()=>{if(currentMode==='performance')lastPerformanceKey=metricSel.value;else lastRobustnessKey=metricSel.value;setMetric(metricSel.value);});
viewSel.addEventListener('change',()=>{if(currentMode==='performance')lastPerformanceView=viewSel.value;draw();});
metricMode.addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(b)setMode(b.dataset.mode);});
addEventListener('resize',size);
(async function init(){try{meta=await fetch('metrics.json?v=008',{cache:'no-store'}).then(r=>r.json());populateMetricOptions('performance');metricSel.value=currentKey;setViewForMode('performance');readCopy.innerHTML=performanceRead;size();await setMetric(currentKey);}catch(e){loading.textContent='Could not initialize interface: '+e.message;}})();
