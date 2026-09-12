(function(root){
  'use strict';

  const VERSION='symmetric-l1-six-map-v015';
  const TAU=0.10;
  const EPS=1e-12;
  const DRIVER_METRICS=['r_per_trade','expectancy_per_contract','profit_factor','romad','max_drawdown_r','total_r'];

  function finite(v){return Number.isFinite(v);}
  function percentileSorted(sorted,p){
    if(!sorted.length)return NaN;
    const x=(sorted.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x);
    return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo);
  }
  function qFinite(values,p){
    const a=[];for(const v of values)if(finite(v))a.push(v);a.sort((x,y)=>x-y);return percentileSorted(a,p);
  }
  function gm(values){
    const a=values.filter(finite);if(!a.length)return NaN;
    if(a.some(v=>v<=0))return a.some(v=>v===0)?0:NaN;
    return Math.exp(a.reduce((s,v)=>s+Math.log(Math.min(1,Math.max(0,v))),0)/a.length);
  }
  function midrank(values,higherBetter,optimum){
    const out=new Float32Array(values.length),idx=[];
    for(let i=0;i<values.length;i++){if(finite(values[i]))idx.push(i);else out[i]=NaN;}
    if(!idx.length)return out;
    let lo=Infinity,hi=-Infinity;for(const i of idx){const v=values[i];if(v<lo)lo=v;if(v>hi)hi=v;}
    const tol=EPS*Math.max(1,Math.abs(lo),Math.abs(hi));
    if(Math.abs(hi-lo)<=tol){
      const s=optimum!==null&&Math.abs(lo-optimum)<=tol?1:.5;
      for(const i of idx)out[i]=s;return out;
    }
    idx.sort((a,b)=>higherBetter?values[a]-values[b]:values[b]-values[a]);
    const den=Math.max(1,idx.length-1);
    for(let s=0;s<idx.length;){
      let e=s+1,anchor=values[idx[s]],tieTol=1e-12*Math.max(1,Math.abs(anchor));
      while(e<idx.length&&Math.abs(values[idx[e]]-anchor)<=tieTol)e++;
      const r=((s+e-1)/2)/den;for(let j=s;j<e;j++)out[idx[j]]=r;s=e;
    }
    return out;
  }
  function robustScale(values,cells){
    const a=[];for(const gi of cells){const v=values[gi];if(finite(v))a.push(v);}a.sort((x,y)=>x-y);
    if(!a.length)return {scale:NaN,p5:NaN,p95:NaN,flat:false,fallback:false};
    const p5=percentileSorted(a,.05),p95=percentileSorted(a,.95),raw=Math.abs(p95-p5),range=Math.abs(a[a.length-1]-a[0]);
    const tol=EPS*Math.max(1,Math.abs(p5),Math.abs(p95),Math.abs(a[0]),Math.abs(a[a.length-1]));
    if(raw>tol)return {scale:raw,p5,p95,flat:false,fallback:false};
    if(range>tol)return {scale:range,p5,p95,flat:false,fallback:true};
    return {scale:1,p5,p95,flat:true,fallback:false};
  }
  function rectMap(r0,r1,c0,c1,totalCols,name){
    const nx=c1-c0,ny=r1-r0,cells=new Int32Array(nx*ny);let k=0;
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)cells[k++]=(r0+y)*totalCols+(c0+x);
    return {name:name||`${r0}:${r1}|${c0}:${c1}`,nx,ny,cells};
  }
  function syntheticMap(name,nx,ny,fn,offset,values){
    const cells=new Int32Array(nx*ny);for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const id=y*nx+x,gi=offset+id;cells[id]=gi;values[gi]=fn(x,y);}
    return {name,nx,ny,cells};
  }
  function diamondIds(nx,ny,x,y,r){
    const ids=[];
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const d=Math.abs(dx)+Math.abs(dy);if(d===0||d>r)continue;
      const xx=x+dx,yy=y+dy;if(xx>=0&&xx<nx&&yy>=0&&yy<ny)ids.push(yy*nx+xx);
    }
    return ids;
  }
  function regionIds(nx,ny,x,y,r){
    const ids=[];
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      if(Math.abs(dx)+Math.abs(dy)>r)continue;const xx=x+dx,yy=y+dy;if(xx>=0&&xx<nx&&yy>=0&&yy<ny)ids.push(yy*nx+xx);
    }
    return ids;
  }
  function tvInRegion(values,map,x,y,r,scale,axis){
    const ids=regionIds(map.nx,map.ny,x,y,r),inside=new Uint8Array(map.nx*map.ny);for(const id of ids)inside[id]=1;
    let sum=0,n=0;
    for(const id of ids){
      const xx=id%map.nx,yy=Math.floor(id/map.nx),gi=map.cells[id],a=values[gi];if(!finite(a))continue;
      if(xx+1<map.nx){const q=id+1;if(inside[q]&&axis!=='y'){const b=values[map.cells[q]];if(finite(b)){sum+=Math.abs(a-b)/scale;n++;}}}
      if(yy+1<map.ny){const q=id+map.nx;if(inside[q]&&axis!=='x'){const b=values[map.cells[q]];if(finite(b)){sum+=Math.abs(a-b)/scale;n++;}}}
    }
    return n?sum/n:NaN;
  }
  function rawPrimitives(values,maps){
    const N=values.length;
    const raw={d1:new Float64Array(N),d2:new Float64Array(N),d3:new Float64Array(N),q2:new Float64Array(N),q3:new Float64Array(N),tv1:new Float64Array(N),tv2:new Float64Array(N),tvx:new Float64Array(N),tvy:new Float64Array(N),k:new Float64Array(N),b2:new Float64Array(N),b3:new Float64Array(N),coverage:new Float64Array(N)};
    for(const a of Object.values(raw))a.fill(NaN);
    const mapScales=[];
    for(const map of maps){
      const rs=robustScale(values,map.cells);mapScales.push({name:map.name,...rs});if(!finite(rs.scale))continue;
      const S=rs.scale;
      for(let id=0;id<map.cells.length;id++){
        const gi=map.cells[id],z=values[gi];if(!finite(z))continue;
        const x=id%map.nx,y=Math.floor(id/map.nx),byR={};
        for(const r of [1,2,3]){
          const ids=diamondIds(map.nx,map.ny,x,y,r),diffs=[];let valid=0;
          for(const q of ids){const v=values[map.cells[q]];if(finite(v)){valid++;diffs.push(rs.flat?0:Math.abs(z-v)/S);}}
          byR[r]={ids,diffs,valid,expected:ids.length};
          raw['d'+r][gi]=diffs.length?diffs.reduce((a,b)=>a+b,0)/diffs.length:NaN;
        }
        raw.q2[gi]=byR[2].diffs.length?qFinite(byR[2].diffs,.90):NaN;
        raw.q3[gi]=byR[3].diffs.length?qFinite(byR[3].diffs,.90):NaN;
        raw.b2[gi]=byR[2].diffs.length?byR[2].diffs.filter(v=>v<=TAU+1e-15).length/byR[2].diffs.length:NaN;
        raw.b3[gi]=byR[3].diffs.length?byR[3].diffs.filter(v=>v<=TAU+1e-15).length/byR[3].diffs.length:NaN;
        raw.coverage[gi]=byR[3].expected?byR[3].valid/byR[3].expected:1;
        raw.tv1[gi]=rs.flat?0:tvInRegion(values,map,x,y,1,S,null);
        raw.tv2[gi]=rs.flat?0:tvInRegion(values,map,x,y,2,S,null);
        raw.tvx[gi]=rs.flat?0:tvInRegion(values,map,x,y,2,S,'x');
        raw.tvy[gi]=rs.flat?0:tvInRegion(values,map,x,y,2,S,'y');
        const ks=[];
        if(x>0&&x+1<map.nx){const a=values[map.cells[id-1]],b=values[map.cells[id+1]];if(finite(a)&&finite(b))ks.push(rs.flat?0:Math.abs(a-2*z+b)/S);}
        if(y>0&&y+1<map.ny){const a=values[map.cells[id-map.nx]],b=values[map.cells[id+map.nx]];if(finite(a)&&finite(b))ks.push(rs.flat?0:Math.abs(a-2*z+b)/S);}
        raw.k[gi]=ks.length?ks.reduce((a,b)=>a+b,0)/ks.length:NaN;
      }
    }
    return {raw,mapScales};
  }
  function normalizeAndCompose(values,maps){
    const {raw,mapScales}=rawPrimitives(values,maps),norm={
      d1:midrank(raw.d1,false,0),d2:midrank(raw.d2,false,0),d3:midrank(raw.d3,false,0),q2:midrank(raw.q2,false,0),q3:midrank(raw.q3,false,0),
      tv1:midrank(raw.tv1,false,0),tv2:midrank(raw.tv2,false,0),tvx:midrank(raw.tvx,false,0),tvy:midrank(raw.tvy,false,0),k:midrank(raw.k,false,0),
      b2:midrank(raw.b2,true,1),b3:midrank(raw.b3,true,1),coverage:midrank(raw.coverage,true,1)
    };
    const N=values.length,local=new Float32Array(N),smooth=new Float32Array(N),directional=new Float32Array(N),breadth=new Float32Array(N),evidence=new Float32Array(N),sr=new Float32Array(N);
    for(let i=0;i<N;i++){
      if(!finite(values[i])){local[i]=smooth[i]=directional[i]=breadth[i]=evidence[i]=sr[i]=NaN;continue;}
      local[i]=gm([norm.d1[i],norm.d2[i],norm.d3[i],norm.q2[i],norm.q3[i]]);
      smooth[i]=gm([norm.tv1[i],norm.tv2[i],norm.k[i]]);
      directional[i]=gm([norm.tvx[i],norm.tvy[i]]);
      breadth[i]=gm([norm.b2[i],norm.b3[i]]);
      evidence[i]=norm.coverage[i];
      sr[i]=gm([local[i],smooth[i],directional[i],breadth[i],evidence[i]]);
    }
    return {version:VERSION,tau:TAU,raw,norm,categories:{localSimilarity:local,smoothness:smooth,directionalStability:directional,breadth,evidence},structural_robustness:sr,mapScales};
  }
  function meanAt(arr,idxs){let s=0,n=0;for(const i of idxs){if(finite(arr[i])){s+=arr[i];n++;}}return n?s/n:NaN;}
  function medianAt(arr,idxs){const a=[];for(const i of idxs)if(finite(arr[i]))a.push(arr[i]);a.sort((x,y)=>x-y);return percentileSorted(a,.5);}
  function runSyntheticSuite(){
    const W=21,H=21,defs=[];
    const c=Math.floor(W/2),cy=Math.floor(H/2);
    defs.push(['flatHigh',(x,y)=>10]);
    defs.push(['flatMid',(x,y)=>0]);
    defs.push(['spike',(x,y)=>(x===c&&y===cy)?10:0]);
    defs.push(['pit',(x,y)=>(x===c&&y===cy)?-10:0]);
    defs.push(['oneBad',(x,y)=>(x===c&&y===cy)?0:1]);
    defs.push(['thinTrench',(x,y)=>x===c?0:1]);
    defs.push(['broadBand',(x,y)=>Math.abs(x-c)<=2?0:1]);
    defs.push(['gradient',(x,y)=>x/(W-1)]);
    defs.push(['checker',(x,y)=>(x+y)%2]);
    defs.push(['cliff',(x,y)=>x<c?0:1]);
    const values=new Float64Array(defs.length*W*H),maps=[],ranges={};let off=0;
    for(const [name,fn] of defs){const m=syntheticMap(name,W,H,fn,off,values);maps.push(m);ranges[name]=[off,off+W*H];off+=W*H;}
    const res=normalizeAndCompose(values,maps),sr=res.structural_robustness;
    const idx=(name,x,y)=>ranges[name][0]+y*W+x,all=name=>Array.from({length:W*H},(_,i)=>ranges[name][0]+i);
    const flatHigh=meanAt(sr,all('flatHigh')),flatMid=meanAt(sr,all('flatMid'));
    const spike=sr[idx('spike',c,cy)],pit=sr[idx('pit',c,cy)];
    const oneAdj=sr[idx('oneBad',c-1,cy)],thinAdj=sr[idx('thinTrench',c-1,cy)],broadAdj=sr[idx('broadBand',c-3,cy)];
    const grad=medianAt(sr,all('gradient')),checker=medianAt(sr,all('checker'));
    const cliffInterior=sr[idx('cliff',2,cy)],cliffNear=sr[idx('cliff',c-1,cy)];
    const negValues=Float64Array.from(values,v=>-v),neg=normalizeAndCompose(negValues,maps).structural_robustness;let maxNegDiff=0;for(let i=0;i<sr.length;i++)if(finite(sr[i])&&finite(neg[i]))maxNegDiff=Math.max(maxNegDiff,Math.abs(sr[i]-neg[i]));
    const tests=[
      ['flat high ≈ flat mediocre',Math.abs(flatHigh-flatMid)<1e-7,{flatHigh,flatMid}],
      ['flat plateau > isolated spike',flatHigh>spike,{flatHigh,spike}],
      ['spike ≈ pit',Math.abs(spike-pit)<1e-7,{spike,pit}],
      ['one bad cell gentler than thin trench',oneAdj>thinAdj,{oneAdj,thinAdj}],
      ['thin trench gentler than broad band',thinAdj>broadAdj,{thinAdj,broadAdj}],
      ['smooth gradient > checkerboard',grad>checker,{grad,checker}],
      ['cliff interior > cliff edge',cliffInterior>cliffNear,{cliffInterior,cliffNear}],
      ['SR(z) = SR(-z)',maxNegDiff<1e-7,{maxNegDiff}]
    ];
    return {passed:tests.every(t=>t[1]),tests,summary:{flatHigh,flatMid,spike,pit,oneAdj,thinAdj,broadAdj,gradientMedian:grad,checkerMedian:checker,cliffInterior,cliffNear,maxNegDiff}};
  }

  const API={VERSION,TAU,DRIVER_METRICS,rectMap,rawPrimitives,compute:normalizeAndCompose,runSyntheticSuite};
  root.SurfaceRobustnessV013=API;

  if(typeof module!=='undefined'&&module.exports)module.exports=API;

  if(typeof window==='undefined'||typeof ROWS==='undefined'||typeof COLS==='undefined')return;

  function installBrowser(){
    if(!meta||!meta.__order__){setTimeout(installBrowser,25);return;}
    const ACCEPTANCE=runSyntheticSuite();
    const REAL_MAPS=[];
  for(const [r0,r1] of [[0,112],[112,224]])for(const [c0,c1] of [[0,60],[60,70],[70,250]])REAL_MAPS.push(rectMap(r0,r1,c0,c1,COLS));
  const robustKey=k=>`sr:${k}`;
  const driverFromKey=k=>k.startsWith('sr:')?k.slice(3):null;
    for(const k of DRIVER_METRICS){const rk=robustKey(k);robustnessKeys.add(rk);meta[rk]={label:`Structural Robustness · ${meta[k]?.label||k}`,lo:0,hi:1,invert:false,decimals:3,group:'robustness'};}
    lastRobustnessKey=robustKey(lastPerformanceKey||'r_per_trade');

  function ensureStore(surface){
    if(!surface.robustnessByMetric||surface.robustnessVersion!==VERSION){surface.robustnessByMetric={};surface.robustnessVersion=VERSION;}
    return surface.robustnessByMetric;
  }
  function ensureMetric(surface,metric){
    if(!ACCEPTANCE.passed)throw new Error('Synthetic robustness acceptance suite failed');
    const store=ensureStore(surface),old=store[metric];
    if(old&&old.version===VERSION&&old.structural_robustness?.length===ROWS*COLS){if(!(old.structural_robustness instanceof Float32Array))old.structural_robustness=new Float32Array(old.structural_robustness);return old;}
    const vals=surface.metrics[metric];if(!vals)throw new Error(`Uploaded CSV does not contain ${metric}`);
    const full=normalizeAndCompose(vals,REAL_MAPS);
    const result={version:VERSION,metric,tau:TAU,mapScales:full.mapScales,structural_robustness:full.structural_robustness};
    store[metric]=result;idbSetActive(surface).catch(()=>{});return result;
  }

  const baseNormalizeStoredSurface=normalizeStoredSurface;
  normalizeStoredSurface=function(s){
    s=baseNormalizeStoredSurface(s);if(!s)return s;
    if(s.robustnessVersion!==VERSION){delete s.robustnessByMetric;s.robustnessVersion=VERSION;}
    if(s.robustnessByMetric)for(const r of Object.values(s.robustnessByMetric))if(r?.structural_robustness&&!(r.structural_robustness instanceof Float32Array))r.structural_robustness=new Float32Array(r.structural_robustness);
    return s;
  };
  const baseBuildUploadedSurface=buildUploadedSurface;
  buildUploadedSurface=function(text,file){const s=baseBuildUploadedSurface(text,file);s.robustnessVersion=VERSION;s.robustnessByMetric={};return s;};

  const basePopulateMetricOptions=populateMetricOptions;
  populateMetricOptions=function(mode){
    if(mode!=='robustness'||!activeSurface)return basePopulateMetricOptions(mode);
    metricSel.innerHTML='';for(const k of DRIVER_METRICS){const rk=robustKey(k),opt=document.createElement('option');opt.value=rk;opt.textContent=meta[rk].label;metricSel.appendChild(opt);}
  };
  const baseDisplayQ=displayQ;
  displayQ=function(i){if(activeSurface&&currentMode==='robustness'&&driverFromKey(currentKey))return Math.round(clamp01(values[i])*15);return baseDisplayQ(i);};
  const baseRobustApprox=robustApprox;
  robustApprox=function(q){return activeSurface&&driverFromKey(currentKey)?Number(q):baseRobustApprox(q);};

  const baseSetMetric=setMetric;
  setMetric=async function(key){
    const driver=activeSurface?driverFromKey(key):null;if(!driver)return baseSetMetric(key);
    currentKey=key;lastRobustnessKey=key;lastPerformanceKey=driver;loading.style.display='flex';loading.textContent=`Calculating ${meta[key].label}…`;
    try{
      const r=ensureMetric(activeSurface,driver);values=r.structural_robustness;currentStats=null;loading.style.display='none';
      statusEl.textContent=`${meta[key].label} · symmetric L1 · 6 hard maps · global normalization · synthetic gate passed`;
      draw();
    }catch(e){loading.style.display='flex';loading.textContent='Could not calculate robustness: '+e.message;statusEl.textContent=`${meta[key].label} failed`;}
  };
  updateRobustnessAvailability=function(){
    const b=metricMode.querySelector('button[data-mode="robustness"]');if(!b)return;
    if(activeSurface){b.disabled=!ACCEPTANCE.passed;b.title=ACCEPTANCE.passed?'Symmetric L1 robustness; six hard maps; soft dividers traversable; global normalization.':'Synthetic acceptance suite failed — real robustness disabled.';}
    else{b.disabled=false;b.title='';}
  };
  const robustRead=`Structural Robustness follows the <b>selected performance metric</b>. Inside each of the six hard-bounded maps it measures symmetric L1 local deviation (R1/R2/R3), Q90 tail deviation, local graph total variation, X/Y directional variation, second-difference roughness, and B2/B3 tolerance breadth. Soft dividers are fully traversable. Raw structural primitives are then percentile-normalized <b>globally across all 56,000 valid cells</b> before the category geometric means are combined.`;
  setMode=async function(mode){
    if(mode===currentMode)return;
    if(currentMode==='performance'){lastPerformanceKey=currentKey;lastPerformanceView=viewSel.value;}else lastRobustnessKey=currentKey;
    currentMode=mode;for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===mode);setViewForMode(mode);populateMetricOptions(mode);readCopy.innerHTML=mode==='robustness'?robustRead:performanceRead;
    let next;if(mode==='robustness')next=activeSurface?robustKey(lastPerformanceKey||'r_per_trade'):'structural_robustness';else next=lastPerformanceKey;
    metricSel.value=next;await setMetric(next);
  };
    updateRobustnessAvailability();
    window.SurfaceRobustnessV013.acceptance=ACCEPTANCE;
    window.SurfaceRobustnessV013.realMaps=REAL_MAPS;
  }
  installBrowser();
})(typeof window!=='undefined'?window:globalThis);
