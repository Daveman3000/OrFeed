(function(){
  const N=ROWS*COLS;
  const ROBUSTNESS_VERSION='master-six-map-v012';
  const TOLERANCE=.10;
  const COVERAGE_MIN=.75;
  const MAPS=[];
  for(const [r0,r1] of [[0,112],[112,224]]){
    for(const [c0,c1] of [[0,60],[60,70],[70,250]]) MAPS.push({r0,r1,c0,c1,nx:c1-c0,ny:r1-r0});
  }

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
  function solve3(A,b){
    const m=[
      [A[0][0],A[0][1],A[0][2],b[0]],
      [A[1][0],A[1][1],A[1][2],b[1]],
      [A[2][0],A[2][1],A[2][2],b[2]],
    ];
    for(let col=0;col<3;col++){
      let piv=col;for(let r=col+1;r<3;r++)if(Math.abs(m[r][col])>Math.abs(m[piv][col]))piv=r;
      if(Math.abs(m[piv][col])<1e-14)return null;
      [m[col],m[piv]]=[m[piv],m[col]];const d=m[col][col];for(let c=col;c<4;c++)m[col][c]/=d;
      for(let r=0;r<3;r++)if(r!==col){const q=m[r][col];for(let c=col;c<4;c++)m[r][c]-=q*m[col][c];}
    }
    return [m[0][3],m[1][3],m[2][3]];
  }
  function planeRoughness(points){
    if(points.length<3)return NaN;
    let s1=0,sx=0,sy=0,sxx=0,syy=0,sxy=0,sz=0,sxz=0,syz=0;
    for(const [x,y,z] of points){s1++;sx+=x;sy+=y;sxx+=x*x;syy+=y*y;sxy+=x*y;sz+=z;sxz+=x*z;syz+=y*z;}
    const coef=solve3([[s1,sx,sy],[sx,sxx,sxy],[sy,sxy,syy]],[sz,sxz,syz]);if(!coef)return NaN;
    let ss=0;for(const [x,y,z] of points){const d=z-(coef[0]+coef[1]*x+coef[2]*y);ss+=d*d;}
    const v=Math.sqrt(ss/points.length);return Math.abs(v)<1e-12?0:v;
  }
  function mapGlobal(m,x,y){return (m.r0+y)*COLS+(m.c0+x);}
  function eachNeighbor(m,x,y,r,fn){
    for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
      const d=Math.abs(dx)+Math.abs(dy);if(d===0||d>r)continue;
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=m.nx||yy<0||yy>=m.ny)continue;fn(xx,yy,d);
    }
  }
  function localRawDiagnostics(vals,p5,p95){
    const support1=new Float64Array(N),support2=new Float64Array(N),support3=new Float64Array(N),floor3=new Float64Array(N),sens1=new Float64Array(N),sens2=new Float64Array(N),rough1=new Float64Array(N),rough2=new Float64Array(N),dirX=new Float64Array(N),dirY=new Float64Array(N),area=new Float64Array(N),depth=new Float64Array(N);
    const tol=Math.max(1e-12,(p95-p5)*TOLERANCE);
    for(const m of MAPS){
      const mn=m.nx*m.ny,localVals=new Float64Array(mn);
      for(let y=0;y<m.ny;y++)for(let x=0;x<m.nx;x++)localVals[y*m.nx+x]=vals[mapGlobal(m,x,y)];
      for(let y=0;y<m.ny;y++)for(let x=0;x<m.nx;x++){
        const li=y*m.nx+x,gi=mapGlobal(m,x,y),center=localVals[li];
        for(const r of [1,2,3]){
          let down=0,abs=0,worst=0,count=0;const pts=[[x,y,center]];
          eachNeighbor(m,x,y,r,(xx,yy)=>{const v=localVals[yy*m.nx+xx],d=Math.max(0,center-v);down+=d;abs+=Math.abs(center-v);if(d>worst)worst=d;count++;if(r<=2)pts.push([xx,yy,v]);});
          const sup=count?-down/count:0,se=count?abs/count:0;
          if(r===1){support1[gi]=sup;sens1[gi]=se;rough1[gi]=planeRoughness(pts);}
          else if(r===2){support2[gi]=sup;sens2[gi]=se;rough2[gi]=planeRoughness(pts);}
          else{support3[gi]=sup;floor3[gi]=-worst;}
        }
        let sx=0,cx=0,sy=0,cy=0;
        for(let step=1;step<=3;step++){
          for(const xx of [x-step,x+step])if(xx>=0&&xx<m.nx){sx+=Math.max(0,center-localVals[y*m.nx+xx]);cx++;}
          for(const yy of [y-step,y+step])if(yy>=0&&yy<m.ny){sy+=Math.max(0,center-localVals[yy*m.nx+x]);cy++;}
        }
        dirX[gi]=cx?-sx/cx:0;dirY[gi]=cy?-sy/cy:0;
        const threshold=center-tol-1e-15;let dep=0;
        for(let r=1;r<=3;r++){let ok=true;eachNeighbor(m,x,y,r,(xx,yy)=>{if(localVals[yy*m.nx+xx]<threshold)ok=false;});if(ok)dep=r;else break;}depth[gi]=dep;
      }
      const activation=Array.from({length:mn},(_,i)=>i).sort((a,b)=>localVals[b]-localVals[a]);
      const queries=Array.from({length:mn},(_,i)=>i).sort((a,b)=>(localVals[b]-tol)-(localVals[a]-tol));
      const parent=new Int32Array(mn);parent.fill(-1);const sz=new Int32Array(mn);let p=0;
      const find=a=>{let x=a;while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
      const unite=(a,b)=>{a=find(a);b=find(b);if(a===b)return;if(sz[a]<sz[b])[a,b]=[b,a];parent[b]=a;sz[a]+=sz[b];};
      const activate=id=>{parent[id]=id;sz[id]=1;const x=id%m.nx,y=Math.floor(id/m.nx);for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]){const xx=x+dx,yy=y+dy;if(xx>=0&&xx<m.nx&&yy>=0&&yy<m.ny){const nb=yy*m.nx+xx;if(parent[nb]!==-1)unite(id,nb);}}};
      for(const q of queries){const threshold=localVals[q]-tol-1e-15;while(p<mn&&localVals[activation[p]]>=threshold){activate(activation[p]);p++;}const x=q%m.nx,y=Math.floor(q/m.nx),gi=mapGlobal(m,x,y);area[gi]=sz[find(q)]/mn;}
    }
    return{tol,support1,support2,support3,floor3,sens1,sens2,rough1,rough2,dirX,dirY,area,depth};
  }
  function computeStructuralRobustness(surface){
    const vals=surface.metrics.r_per_trade;if(!vals||vals.length!==N)throw new Error('R / trade array missing for robustness');
    const p5=percentile(vals,.05),p95=percentile(vals,.95),d=localRawDiagnostics(vals,p5,p95);
    const ns1=rankGlobal(d.support1,true,0),ns2=rankGlobal(d.support2,true,0),ns3=rankGlobal(d.support3,true,0),nf=rankGlobal(d.floor3,true,0),nse1=rankGlobal(d.sens1,false,0),nse2=rankGlobal(d.sens2,false,0),nr1=rankGlobal(d.rough1,false,0),nr2=rankGlobal(d.rough2,false,0),ndx=rankGlobal(d.dirX,true,0),ndy=rankGlobal(d.dirY,true,0),na=rankGlobal(d.area,true,1),nd=rankGlobal(d.depth,true,3);
    const robust=new Float32Array(N),quality=buildMidranks(vals);
    for(let i=0;i<N;i++){
      const local=gm([ns1[i],ns2[i],ns3[i],nf[i]]),smooth=gm([nse1[i],nse2[i],nr1[i],nr2[i]]),direction=gm([ndx[i],ndy[i]]),breadth=gm([na[i],nd[i]]),evidence=1;
      robust[i]=gm([local,smooth,direction,breadth,evidence]);
    }
    return{version:ROBUSTNESS_VERSION,metric:'r_per_trade',topologyMaps:6,hardBounds:{y:[112],x:[60,70]},softBounds:{x:[30,65,160,...stopBoundaries]},coverageMin:COVERAGE_MIN,tolerance:TOLERANCE,toleranceRaw:d.tol,p5,p95,structural_robustness:robust,quality};
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
    if(activeSurface){try{ensureRobustness(activeSurface);b.disabled=false;b.title='Structural robustness: six hard-bounded maps; all internal soft bounds remain connected; diagnostics normalized globally.';idbSetActive(activeSurface).catch(()=>{});}catch(e){b.disabled=true;b.title='Robustness calculation failed: '+e.message;}}
    else{b.disabled=false;b.title='';}
  };
  const robustnessReadV012=`Structural Robustness uses exactly <b>six topology maps</b>: Points/ATR × Fixed/Trail/Hybrid. Only those regime boundaries are hard. Trade-count, stop-size and nested management dividers are <b>soft</b>, so R1/R2/R3 neighborhoods, smoothness and breadth continue across them. Raw structural diagnostics are calculated locally inside each map, then <b>normalized globally across all 56,000 cells</b>.`;
  setMode=async function(mode){
    if(mode===currentMode)return;
    if(currentMode==='performance'){lastPerformanceKey=currentKey;lastPerformanceView=viewSel.value;}else lastRobustnessKey=currentKey;
    currentMode=mode;for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===mode);setViewForMode(mode);populateMetricOptions(mode);readCopy.innerHTML=mode==='robustness'?robustnessReadV012:performanceRead;
    const next=mode==='robustness'?lastRobustnessKey:lastPerformanceKey;metricSel.value=next;await setMetric(next);
  };
  globalThis.SurfaceRobustnessV012={compute:computeStructuralRobustness,ensure:ensureRobustness,maps:MAPS};
  if(activeSurface)updateRobustnessAvailability();
})();
