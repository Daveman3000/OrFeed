(function(root){
  'use strict';
  const T=root.SurfaceTopologyV016;if(!T)throw new Error('Surface topology v016 missing');
  const VERSION='semantic-graph-symmetric-l1-v016',TAU=.10,EPS=1e-12;
  const DRIVER_METRICS=['r_per_trade','expectancy_per_contract','profit_factor','romad','max_drawdown_r','total_r'];
  const {buildSemanticGraph}=T;
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
    if(a.some(v=>v===0))return 0;
    if(a.some(v=>v<0))return NaN;
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
  function expectedNeighborhoodCount(node,r){
    const dims=node.ordered;let count=0;
    function rec(k,remaining,dist){
      if(k===dims.length){if(dist>0)count++;return;}
      const o=dims[k];
      for(let delta=-remaining;delta<=remaining;delta++){
        if(o.index+delta<0||o.index+delta>=o.length)continue;
        const ad=Math.abs(delta);rec(k+1,remaining-ad,dist+ad);
      }
    }
    rec(0,r,0);return count;
  }
  function robustScales(values,graph){
    const out=new Map();
    for(const [hard,cells] of graph.surfaceCells){
      const a=[];for(const i of cells)if(finite(values[i]))a.push(values[i]);a.sort((x,y)=>x-y);
      if(!a.length){out.set(hard,{scale:NaN,p5:NaN,p95:NaN,flat:false,fallback:false});continue;}
      const p5=percentileSorted(a,.05),p95=percentileSorted(a,.95),raw=Math.abs(p95-p5),range=Math.abs(a[a.length-1]-a[0]);
      const tol=EPS*Math.max(1,Math.abs(p5),Math.abs(p95),Math.abs(a[0]),Math.abs(a[a.length-1]));
      if(raw>tol)out.set(hard,{scale:raw,p5,p95,flat:false,fallback:false});
      else if(range>tol)out.set(hard,{scale:range,p5,p95,flat:false,fallback:true});
      else out.set(hard,{scale:1,p5,p95,flat:true,fallback:false});
    }
    return out;
  }
  function neighborhoods(graph,start,stamp,token){
    const n1=[],n2=[],n3=[],q=[start],depth=[0];stamp[start]=token;
    for(let h=0;h<q.length;h++){
      const u=q[h],d=depth[h];if(d===3)continue;
      for(const v of graph.adj[u])if(stamp[v]!==token){stamp[v]=token;const nd=d+1;q.push(v);depth.push(nd);n3.push(v);if(nd<=2)n2.push(v);if(nd<=1)n1.push(v);}
    }
    return {n1,n2,n3};
  }
  function tvRegion(values,graph,ids,scale,flat,regionStamp,token){
    if(flat)return 0;
    for(const i of ids)regionStamp[i]=token;
    let sum=0,n=0;
    for(const u of ids){const a=values[u];if(!finite(a))continue;for(const v of graph.adj[u])if(v>u&&regionStamp[v]===token){const b=values[v];if(finite(b)){sum+=Math.abs(a-b)/scale;n++;}}}
    return n?sum/n:NaN;
  }
  function rawPrimitives(values,graph){
    const N=values.length;
    const raw={d1:new Float64Array(N),d2:new Float64Array(N),d3:new Float64Array(N),q2:new Float64Array(N),q3:new Float64Array(N),tv1:new Float64Array(N),tv2:new Float64Array(N),k:new Float64Array(N),b2:new Float64Array(N),b3:new Float64Array(N),coverage:new Float64Array(N),directional:Object.create(null)};
    for(const k of ['d1','d2','d3','q2','q3','tv1','tv2','k','b2','b3','coverage'])raw[k].fill(NaN);
    const orderedIds=[...new Set(graph.configs.flatMap(c=>c.ordered.map(o=>o.id)))];
    for(const id of orderedIds){raw.directional[id]=new Float64Array(N);raw.directional[id].fill(NaN);}
    const scales=robustScales(values,graph),stamp=new Int32Array(N),regionStamp=new Int32Array(N);let token=0,regionToken=0;
    for(let i=0;i<N;i++){
      const z=values[i];if(!finite(z))continue;const node=graph.configs[i],rs=scales.get(node.hard);if(!rs||!finite(rs.scale))continue;const S=rs.scale;
      token++;const ns=neighborhoods(graph,i,stamp,token);
      const byR={1:ns.n1,2:ns.n2,3:ns.n3};
      for(const r of [1,2,3]){
        const diffs=[];for(const j of byR[r]){const v=values[j];if(finite(v))diffs.push(rs.flat?0:Math.abs(z-v)/S);}
        raw['d'+r][i]=diffs.length?diffs.reduce((a,b)=>a+b,0)/diffs.length:NaN;
        if(r===2){raw.q2[i]=diffs.length?qFinite(diffs,.90):NaN;raw.b2[i]=diffs.length?diffs.filter(v=>v<=TAU+1e-15).length/diffs.length:NaN;}
        if(r===3){raw.q3[i]=diffs.length?qFinite(diffs,.90):NaN;raw.b3[i]=diffs.length?diffs.filter(v=>v<=TAU+1e-15).length/diffs.length:NaN;}
      }
      const expected3=expectedNeighborhoodCount(node,3),valid3=ns.n3.reduce((n,j)=>n+(finite(values[j])?1:0),0);raw.coverage[i]=expected3?valid3/expected3:1;
      regionToken++;raw.tv1[i]=tvRegion(values,graph,[i,...ns.n1],S,rs.flat,regionStamp,regionToken);
      regionToken++;raw.tv2[i]=tvRegion(values,graph,[i,...ns.n2],S,rs.flat,regionStamp,regionToken);
      const ks=[];
      for(const o of node.ordered){
        const edges=graph.byParam[i][o.id]||[],vals=[];let lo=null,hi=null;
        for(const e of edges){const v=values[e.to];if(finite(v)){vals.push(rs.flat?0:Math.abs(z-v)/S);if(e.delta<0)lo=v;if(e.delta>0)hi=v;}}
        if(vals.length)raw.directional[o.id][i]=vals.reduce((a,b)=>a+b,0)/vals.length;
        if(lo!==null&&hi!==null)ks.push(rs.flat?0:Math.abs(lo-2*z+hi)/S);
      }
      raw.k[i]=ks.length?ks.reduce((a,b)=>a+b,0)/ks.length:NaN;
    }
    return {raw,scales};
  }
  function normalizeAndCompose(values,graph){
    if(values.length!==graph.configs.length)throw new Error('Metric array length does not match semantic graph');
    const {raw,scales}=rawPrimitives(values,graph),norm={
      d1:midrank(raw.d1,false,0),d2:midrank(raw.d2,false,0),d3:midrank(raw.d3,false,0),q2:midrank(raw.q2,false,0),q3:midrank(raw.q3,false,0),
      tv1:midrank(raw.tv1,false,0),tv2:midrank(raw.tv2,false,0),k:midrank(raw.k,false,0),b2:midrank(raw.b2,true,1),b3:midrank(raw.b3,true,1),coverage:midrank(raw.coverage,true,1),directional:Object.create(null)
    };
    for(const [id,a] of Object.entries(raw.directional))norm.directional[id]=midrank(a,false,0);
    const N=values.length,local=new Float32Array(N),smooth=new Float32Array(N),tm=new Float32Array(N),context=new Float32Array(N),directional=new Float32Array(N),breadth=new Float32Array(N),evidence=new Float32Array(N),sr=new Float32Array(N);
    for(let i=0;i<N;i++){
      if(!finite(values[i])){for(const a of [local,smooth,tm,context,directional,breadth,evidence,sr])a[i]=NaN;continue;}
      local[i]=gm([norm.d1[i],norm.d2[i],norm.d3[i],norm.q2[i],norm.q3[i]]);
      smooth[i]=gm([norm.tv1[i],norm.tv2[i],norm.k[i]]);
      const tmScores=[],contextScores=[];
      for(const o of graph.configs[i].ordered){const score=norm.directional[o.id]?.[i];if(!finite(score))continue;if(o.family==='tm')tmScores.push(score);else if(o.family==='context')contextScores.push(score);}
      tm[i]=gm(tmScores);context[i]=gm(contextScores);directional[i]=gm([tm[i],context[i]]);
      breadth[i]=gm([norm.b2[i],norm.b3[i]]);evidence[i]=norm.coverage[i];sr[i]=gm([local[i],smooth[i],directional[i],breadth[i],evidence[i]]);
    }
    return {version:VERSION,tau:TAU,raw,norm,categories:{localSimilarity:local,smoothness:smooth,tmStability:tm,contextStability:context,directionalStability:directional,breadth,evidence},structural_robustness:sr,scales};
  }
  function syntheticDescriptor(){return {descriptor_schema_version:1,descriptor_version:'synthetic',study_id:'synthetic',parameters:[{id:'case',topology_role:'regime'},{id:'x',topology_role:'ordered',ordered_values:Array.from({length:21},(_,i)=>i)},{id:'y',topology_role:'ordered',ordered_values:Array.from({length:21},(_,i)=>i)}]};}
  function runSyntheticSuite(){
    const W=21,H=21,c=10,cy=10,defs=[
      ['flatHigh',(x,y)=>10],['flatMid',(x,y)=>0],['spike',(x,y)=>(x===c&&y===cy)?10:0],['pit',(x,y)=>(x===c&&y===cy)?-10:0],
      ['oneBad',(x,y)=>(x===c&&y===cy)?0:1],['thinTrench',(x,y)=>x===c?0:1],['broadBand',(x,y)=>Math.abs(x-c)<=2?0:1],
      ['gradient',(x,y)=>x/(W-1)],['checker',(x,y)=>(x+y)%2],['cliff',(x,y)=>x<c?0:1]
    ];
    const descriptor=syntheticDescriptor(),configs=[],vals=[];
    for(let ci=0;ci<defs.length;ci++){const [name,fn]=defs[ci];for(let y=0;y<H;y++)for(let x=0;x<W;x++){configs.push({id:`${name}:${x}:${y}`,params:{case:name,x,y}});vals.push(fn(x,y));}}
    const values=Float64Array.from(vals),graph=buildSemanticGraph(configs,descriptor),res=normalizeAndCompose(values,graph),sr=res.structural_robustness,index=new Map(configs.map((c,i)=>[c.id,i]));
    const ids=name=>configs.map((q,i)=>q.params.case===name?i:-1).filter(i=>i>=0),mean=a=>a.reduce((s,i)=>s+sr[i],0)/a.length,median=a=>{const z=a.map(i=>sr[i]).sort((a,b)=>a-b);return percentileSorted(z,.5);};
    const flatHigh=mean(ids('flatHigh')),flatMid=mean(ids('flatMid')),spike=sr[index.get(`spike:${c}:${cy}`)],pit=sr[index.get(`pit:${c}:${cy}`)];
    const oneAdj=sr[index.get(`oneBad:${c-1}:${cy}`)],thinAdj=sr[index.get(`thinTrench:${c-1}:${cy}`)],broadAdj=sr[index.get(`broadBand:${c-3}:${cy}`)];
    const gradient=median(ids('gradient')),checker=median(ids('checker')),cliffInterior=sr[index.get(`cliff:2:${cy}`)],cliffNear=sr[index.get(`cliff:${c-1}:${cy}`)];
    const neg=normalizeAndCompose(Float64Array.from(values,v=>-v),graph).structural_robustness;let maxNegDiff=0;for(let i=0;i<sr.length;i++)maxNegDiff=Math.max(maxNegDiff,Math.abs(sr[i]-neg[i]));
    const perm=Array.from({length:configs.length},(_,i)=>(i*1543)%configs.length);
    const seen=new Set(perm);if(seen.size!==configs.length)throw new Error('Synthetic permutation is not bijective');
    const pc=perm.map(i=>configs[i]),pv=Float64Array.from(perm.map(i=>values[i])),pg=buildSemanticGraph(pc,descriptor),psr=normalizeAndCompose(pv,pg).structural_robustness,pIndex=new Map(pc.map((c,i)=>[c.id,i]));let maxPermutationDiff=0;
    for(let i=0;i<configs.length;i++)maxPermutationDiff=Math.max(maxPermutationDiff,Math.abs(sr[i]-psr[pIndex.get(configs[i].id)]));
    const tests=[
      ['flat high ≈ flat mediocre',Math.abs(flatHigh-flatMid)<1e-7,{flatHigh,flatMid}],
      ['flat plateau > isolated spike',flatHigh>spike,{flatHigh,spike}],
      ['spike ≈ pit',Math.abs(spike-pit)<1e-7,{spike,pit}],
      ['one bad cell gentler than thin trench',oneAdj>thinAdj,{oneAdj,thinAdj}],
      ['thin trench gentler than broad band',thinAdj>broadAdj,{thinAdj,broadAdj}],
      ['smooth gradient > checkerboard',gradient>checker,{gradient,checker}],
      ['cliff interior > cliff edge',cliffInterior>cliffNear,{cliffInterior,cliffNear}],
      ['SR(z) = SR(-z)',maxNegDiff<1e-7,{maxNegDiff}],
      ['visual permutation invariant',maxPermutationDiff<1e-7,{maxPermutationDiff}]
    ];
    return {passed:tests.every(t=>t[1]),tests,summary:{flatHigh,flatMid,spike,pit,oneAdj,thinAdj,broadAdj,gradient,checker,cliffInterior,cliffNear,maxNegDiff,maxPermutationDiff,components:graph.components}};
  }
  const API={VERSION,TAU,DRIVER_METRICS,DESCRIPTOR:T.DESCRIPTOR,buildVolspikeConfigs:T.buildVolspikeConfigs,buildSemanticGraph:T.buildSemanticGraph,rawPrimitives,compute:normalizeAndCompose,runSyntheticSuite};
  root.SurfaceRobustnessEngineV016=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis);
