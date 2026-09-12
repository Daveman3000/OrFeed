(function(){
  const N=ROWS*COLS;
  const ROBUSTNESS_VERSION='master-topology-v011';
  const TOLERANCE=.10;
  const COVERAGE_MIN=.75;
  const topoCache=new Map();

  function percentile(a,p){
    const s=Array.from(a).sort((x,y)=>x-y),pos=(s.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);
    return lo===hi?s[lo]:s[lo]+(s[hi]-s[lo])*(pos-lo);
  }
  function gm(vals){
    if(!vals.length||vals.some(v=>!Number.isFinite(v)||v<0))return NaN;
    if(vals.some(v=>v===0))return 0;
    return Math.exp(vals.reduce((s,v)=>s+Math.log(Math.min(1,Math.max(0,v))),0)/vals.length);
  }
  function rankGlobal(values,higherBetter=true,theoreticalOptimum=null){
    const out=new Float32Array(values.length),idx=[];
    for(let i=0;i<values.length;i++)if(Number.isFinite(values[i]))idx.push(i);else out[i]=NaN;
    if(!idx.length)return out;
    let min=Infinity,max=-Infinity;for(const i of idx){const v=values[i];if(v<min)min=v;if(v>max)max=v;}
    if(Math.abs(max-min)<=1e-12){
      const score=theoreticalOptimum!==null&&Math.abs(min-theoreticalOptimum)<=1e-12?1:.5;
      for(const i of idx)out[i]=score;return out;
    }
    idx.sort((a,b)=>(higherBetter?values[a]-values[b]:values[b]-values[a]));
    const den=Math.max(1,idx.length-1);
    for(let s=0;s<idx.length;){
      let e=s+1;while(e<idx.length&&values[idx[e]]===values[idx[s]])e++;
      const score=((s+e-1)/2)/den;for(let j=s;j<e;j++)out[idx[j]]=score;s=e;
    }
    return out;
  }
  function solveLinear(A,b){
    const n=b.length,m=A.map((r,i)=>[...r,b[i]]);
    for(let c=0;c<n;c++){
      let p=c;for(let r=c+1;r<n;r++)if(Math.abs(m[r][c])>Math.abs(m[p][c]))p=r;
      if(Math.abs(m[p][c])<1e-12)return null;
      [m[c],m[p]]=[m[p],m[c]];const d=m[c][c];for(let j=c;j<=n;j++)m[c][j]/=d;
      for(let r=0;r<n;r++)if(r!==c){const q=m[r][c];for(let j=c;j<=n;j++)m[r][j]-=q*m[c][j];}
    }
    return m.map(r=>r[n]);
  }
  function hyperRoughness(ids,template,mapCells,vals){
    const d=template.dims.length,k=d+1,A=Array.from({length:k},()=>Array(k).fill(0)),b=Array(k).fill(0),points=[];
    for(const id of ids){const gi=mapCells[id],z=vals[gi],x=[1,...template.coords[id]];points.push([x,z]);for(let i=0;i<k;i++){b[i]+=x[i]*z;for(let j=0;j<k;j++)A[i][j]+=x[i]*x[j];}}
    const beta=solveLinear(A,b);if(!beta)return NaN;
    let ss=0;for(const [x,z] of points){let fit=0;for(let i=0;i<k;i++)fit+=beta[i]*x[i];const e=z-fit;ss+=e*e;}return Math.sqrt(ss/points.length);
  }
  function makeTemplate(dims){
    const key=dims.join('x');if(topoCache.has(key))return topoCache.get(key);
    const strides=[];let size=1;for(let i=dims.length-1;i>=0;i--){strides[i]=size;size*=dims[i];}
    const coords=Array(size);for(let id=0;id<size;id++){let x=id,c=[];for(let k=0;k<dims.length;k++){c[k]=Math.floor(x/strides[k])%dims[k];}coords[id]=c;}
    const idOf=c=>c.reduce((s,v,k)=>s+v*strides[k],0);
    const adj1=Array.from({length:size},()=>[]),r1=Array.from({length:size},()=>[]),r2=Array.from({length:size},()=>[]),r3=Array.from({length:size},()=>[]),directional=Array.from({length:size},()=>Array.from({length:dims.length},()=>[]));
    for(let id=0;id<size;id++){
      const c=coords[id];
      for(let k=0;k<dims.length;k++)for(const step of [-1,1]){const v=c[k]+step;if(v>=0&&v<dims[k]){const cc=c.slice();cc[k]=v;adj1[id].push(idOf(cc));}}
      for(let j=0;j<size;j++)if(j!==id){let dist=0,diffDim=-1,diffCount=0;for(let k=0;k<dims.length;k++){const q=Math.abs(coords[j][k]-c[k]);dist+=q;if(q){diffDim=k;diffCount++;}}if(dist<=1)r1[id].push(j);if(dist<=2)r2[id].push(j);if(dist<=3)r3[id].push(j);if(diffCount===1&&dist<=3)directional[id][diffDim].push(j);}
    }
    const t={dims,size,coords,adj1,r1,r2,r3,directional,idOf};topoCache.set(key,t);return t;
  }
  function outerTopo(row){
    const rangeMode=row>=112?1:0,local=row%112,threshold=Math.floor(local/16),within=local%16,londonClose=within>=8?1:0,w=within%8,pm=Math.floor(w/2),entry=w%2;
    return{rangeMode,threshold,londonClose,pm,entry};
  }
  function innerTopo(orig){
    const stop=Math.floor(orig/50),trades=orig%2===0?1:2,scenario=Math.floor((orig%50)/2);
    if(scenario<=5)return{tm:0,trades,stop,rule:scenario===0?0:1,multiple:scenario===0?null:scenario-1,allocation:null};
    if(scenario===6)return{tm:1,trades,stop,rule:null,multiple:null,allocation:null};
    const j=scenario-7,allocation=Math.floor(j/6),v=j%6;return{tm:2,trades,stop,rule:v===0?0:1,multiple:v===0?null:v-1,allocation};
  }
  function topologyForCell(row,col){
    const o=outerTopo(row),orig=meta.__order__[col],i=innerTopo(orig);
    const signature=[o.rangeMode,i.tm,i.trades,o.londonClose,o.pm,o.entry,i.rule===null?-1:i.rule].join('|');
    const coords=[o.threshold,i.stop],dims=[7,5];
    if(i.tm===2){coords.push(i.allocation);dims.push(3);}
    if(i.rule===1){coords.push(i.multiple);dims.push(5);}
    return{signature,coords,dims};
  }
  function buildMaps(){
    const maps=new Map();
    for(let row=0;row<ROWS;row++)for(let col=0;col<COLS;col++){
      const g=row*COLS+col,t=topologyForCell(row,col);let m=maps.get(t.signature);
      if(!m){const template=makeTemplate(t.dims);m={signature:t.signature,template,cells:new Int32Array(template.size).fill(-1)};maps.set(t.signature,m);}
      const id=m.template.idOf(t.coords);if(m.cells[id]!==-1)throw new Error('Duplicate topology coordinate');m.cells[id]=g;
    }
    for(const m of maps.values())for(const g of m.cells)if(g<0)throw new Error('Incomplete topology map');
    if(maps.size!==320)throw new Error(`Expected 320 topology maps, got ${maps.size}`);
    return maps;
  }
  function computeStructuralRobustness(surface){
    const vals=surface.metrics.r_per_trade;if(!vals||vals.length!==N)throw new Error('R / trade array missing for robustness');
    const maps=buildMaps(),p5=percentile(vals,.05),p95=percentile(vals,.95),tol=Math.max(1e-12,(p95-p5)*TOLERANCE);
    const s1=new Float64Array(N),s2=new Float64Array(N),s3=new Float64Array(N),floor3=new Float64Array(N),sens1=new Float64Array(N),sens2=new Float64Array(N),rough1=new Float64Array(N),rough2=new Float64Array(N),area=new Float64Array(N),depth=new Float64Array(N),dirRaw=Array.from({length:N},()=>null);
    for(const m of maps.values()){
      const t=m.template,cells=m.cells,stamp=new Int32Array(t.size);let token=0;
      for(let id=0;id<t.size;id++){
        const gi=cells[id],center=vals[gi];
        const diag=(ids)=>{let down=0,abs=0,worst=0;for(const q of ids){const v=vals[cells[q]],d=Math.max(0,center-v);down+=d;abs+=Math.abs(center-v);if(d>worst)worst=d;}return{support:ids.length?-down/ids.length:0,sensitivity:ids.length?abs/ids.length:0,worst:ids.length?-worst:0};};
        const a=diag(t.r1[id]),b=diag(t.r2[id]),c=diag(t.r3[id]);s1[gi]=a.support;s2[gi]=b.support;s3[gi]=c.support;floor3[gi]=c.worst;sens1[gi]=a.sensitivity;sens2[gi]=b.sensitivity;
        rough1[gi]=hyperRoughness([id,...t.r1[id]],t,cells,vals);rough2[gi]=hyperRoughness([id,...t.r2[id]],t,cells,vals);
        dirRaw[gi]=t.directional[id].map(ids=>{let d=0;for(const q of ids)d+=Math.max(0,center-vals[cells[q]]);return ids.length?-d/ids.length:0;});
        token++;const stack=[id];stamp[id]=token;let count=0;
        while(stack.length){const q=stack.pop();count++;for(const nb of t.adj1[q])if(stamp[nb]!==token&&vals[cells[nb]]>=center-tol-1e-15){stamp[nb]=token;stack.push(nb);}}
        area[gi]=count/t.size;let dep=0;for(const [r,list] of [[1,t.r1[id]],[2,t.r2[id]],[3,t.r3[id]]]){let ok=true;for(const q of list)if(stamp[q]!==token){ok=false;break;}if(ok)dep=r;else break;}depth[gi]=dep;
      }
    }
    const ns1=rankGlobal(s1,true,0),ns2=rankGlobal(s2,true,0),ns3=rankGlobal(s3,true,0),nf=rankGlobal(floor3,true,0),nse1=rankGlobal(sens1,false,0),nse2=rankGlobal(sens2,false,0),nr1=rankGlobal(rough1,false,0),nr2=rankGlobal(rough2,false,0),na=rankGlobal(area,true,1),nd=rankGlobal(depth,true,3);
    const flatDir=[],refs=[];for(let i=0;i<N;i++)for(let k=0;k<dirRaw[i].length;k++){flatDir.push(dirRaw[i][k]);refs.push([i,k]);}
    const ndir=rankGlobal(flatDir,true,0),dirScores=Array.from({length:N},()=>[]);for(let j=0;j<refs.length;j++)dirScores[refs[j][0]].push(ndir[j]);
    const robust=new Float32Array(N),quality=buildMidranks(vals);
    for(let i=0;i<N;i++){
      const local=gm([ns1[i],ns2[i],ns3[i],nf[i]]),smooth=gm([nse1[i],nse2[i],nr1[i],nr2[i]]),direction=gm(dirScores[i]),breadth=gm([na[i],nd[i]]),evidence=1;
      robust[i]=gm([local,smooth,direction,breadth,evidence]);
    }
    return{version:ROBUSTNESS_VERSION,metric:'r_per_trade',topologyMaps:maps.size,coverageMin:COVERAGE_MIN,tolerance:TOLERANCE,p5,p95,structural_robustness:robust,quality};
  }
  function ensureRobustness(surface){
    if(!surface)return null;
    const r=surface.robustness;
    if(r&&r.version===ROBUSTNESS_VERSION&&r.structural_robustness&&r.structural_robustness.length===N){if(!(r.structural_robustness instanceof Float32Array))r.structural_robustness=new Float32Array(r.structural_robustness);return r;}
    surface.robustness=computeStructuralRobustness(surface);return surface.robustness;
  }

  const baseBuildUploadedSurface=buildUploadedSurface;
  buildUploadedSurface=function(text,file){const surface=baseBuildUploadedSurface(text,file);ensureRobustness(surface);return surface;};
  const baseNormalizeStoredSurface=normalizeStoredSurface;
  normalizeStoredSurface=function(s){s=baseNormalizeStoredSurface(s);if(s&&s.robustness?.structural_robustness&&!(s.robustness.structural_robustness instanceof Float32Array))s.robustness.structural_robustness=new Float32Array(s.robustness.structural_robustness);return s;};
  const baseDecodeMetric=decodeMetric;
  decodeMetric=async function(key){if(activeSurface&&key==='structural_robustness')return ensureRobustness(activeSurface).structural_robustness;return baseDecodeMetric(key);};
  const baseDisplayQ=displayQ;
  displayQ=function(i){if(activeSurface&&isRobust())return Math.round(clamp01(values[i])*15);return baseDisplayQ(i);};
  const baseRobustApprox=robustApprox;
  robustApprox=function(q){return activeSurface?Number(q):baseRobustApprox(q);};
  updateRobustnessAvailability=function(){
    const b=metricMode.querySelector('button[data-mode="robustness"]');if(!b)return;
    if(activeSurface){try{ensureRobustness(activeSurface);b.disabled=false;b.title='Structural robustness computed locally from 320 hard-bounded topology maps; diagnostics normalized globally.';idbSetActive(activeSurface).catch(()=>{});}catch(e){b.disabled=true;b.title='Robustness calculation failed: '+e.message;}}
    else{b.disabled=false;b.title='';}
  };
  const robustnessReadV011=`Structural Robustness uses <b>320 separate hard-bounded topology maps</b>. R1/R2/R3 support, sensitivity, smoothness, direction and breadth are calculated only inside each valid map; no calculation crosses a regime/facet break. Those structural outputs are then <b>normalized globally across the full 56,000 configurations</b> so robustness scores are comparable across maps.`;
  setMode=async function(mode){
    if(mode===currentMode)return;
    if(currentMode==='performance'){lastPerformanceKey=currentKey;lastPerformanceView=viewSel.value;}else lastRobustnessKey=currentKey;
    currentMode=mode;for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===mode);setViewForMode(mode);populateMetricOptions(mode);readCopy.innerHTML=mode==='robustness'?robustnessReadV011:performanceRead;
    const next=mode==='robustness'?lastRobustnessKey:lastPerformanceKey;metricSel.value=next;await setMetric(next);
  };
  window.SurfaceRobustnessV011={compute:computeStructuralRobustness,ensure:ensureRobustness};
  if(activeSurface)updateRobustnessAvailability();
})();
