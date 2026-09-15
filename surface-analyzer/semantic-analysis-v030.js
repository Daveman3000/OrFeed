(function(root){
  'use strict';

  const VERSION='generic-semantic-analysis-v030';
  const TAU=.10,EPS=1e-12;
  const DRIVER_METRICS=['r_per_trade','expectancy_per_contract','profit_factor','romad','max_drawdown_r','total_r'];
  const finite=Number.isFinite;
  const token=v=>v==null?'':String(v);
  const domain=d=>d.values||d.ordered_values||[];

  function same(a,b){if(a==null||a==='')return b==null||b==='';return typeof b==='number'?Number(a)===b:String(a)===String(b);}
  function activeWhen(rule,params){
    if(!rule||rule==='always')return true;
    if(rule.op==='eq')return same(params[rule.parameter],rule.value);
    if(rule.op==='in')return (rule.values||[]).some(v=>same(params[rule.parameter],v));
    if(rule.op==='and')return (rule.clauses||[]).every(c=>activeWhen(c,params));
    throw new Error(`Unsupported active_when op ${rule.op}`);
  }
  function refs(rule,out=new Set()){
    if(!rule||rule==='always')return out;
    if(rule.op==='eq'||rule.op==='in'){if(rule.parameter)out.add(rule.parameter);return out;}
    if(rule.op==='and')for(const c of rule.clauses||[])refs(c,out);
    return out;
  }
  function percentileSorted(sorted,p){if(!sorted.length)return NaN;const x=(sorted.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x);return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo);}
  function qFinite(values,p){const a=[];for(const v of values)if(finite(v))a.push(v);a.sort((x,y)=>x-y);return percentileSorted(a,p);}
  function gm(values){const a=values.filter(finite);if(!a.length)return NaN;if(a.some(v=>v===0))return 0;if(a.some(v=>v<0))return NaN;return Math.exp(a.reduce((s,v)=>s+Math.log(Math.min(1,Math.max(0,v))),0)/a.length);}
  function midrank(values,higherBetter,optimum){
    const out=new Float32Array(values.length),idx=[];for(let i=0;i<values.length;i++){if(finite(values[i]))idx.push(i);else out[i]=NaN;}if(!idx.length)return out;
    let lo=Infinity,hi=-Infinity;for(const i of idx){const v=values[i];if(v<lo)lo=v;if(v>hi)hi=v;}const tol=EPS*Math.max(1,Math.abs(lo),Math.abs(hi));
    if(Math.abs(hi-lo)<=tol){const s=optimum!==null&&Math.abs(lo-optimum)<=tol?1:.5;for(const i of idx)out[i]=s;return out;}
    idx.sort((a,b)=>higherBetter?values[a]-values[b]:values[b]-values[a]);const den=Math.max(1,idx.length-1);
    for(let s=0;s<idx.length;){let e=s+1,anchor=values[idx[s]],tieTol=EPS*Math.max(1,Math.abs(anchor));while(e<idx.length&&Math.abs(values[idx[e]]-anchor)<=tieTol)e++;const r=((s+e-1)/2)/den;for(let j=s;j<e;j++)out[idx[j]]=r;s=e;}
    return out;
  }

  function descriptorInfo(surface){
    const d=surface?.semanticDescriptor;if(!d||!Array.isArray(d.parameters))throw new Error('Semantic descriptor is missing');
    const defs=d.parameters,byId=Object.fromEntries(defs.map((p,i)=>[p.id,{...p,_i:i}])),ordered=[],facets=[],regimes=[];
    for(let i=0;i<defs.length;i++){
      const p=defs[i];if(!Array.isArray(domain(p))||!domain(p).length)throw new Error(`${p.id}: declared values are required`);
      if(p.topology_role==='ordered')ordered.push(i);else if(p.topology_role==='facet')facets.push(i);else if(p.topology_role==='regime')regimes.push(i);
    }
    const downstream=Array.from({length:defs.length},()=>new Set());
    for(let j=0;j<defs.length;j++)for(const id of refs(defs[j].active_when)){const q=byId[id];if(q)downstream[q._i].add(j);}
    let changed=true;while(changed){changed=false;for(let i=0;i<defs.length;i++){const add=[];for(const j of downstream[i])for(const k of downstream[j])if(!downstream[i].has(k))add.push(k);if(add.length){changed=true;for(const k of add)downstream[i].add(k);}}}
    return {d,defs,byId,ordered,facets,regimes,downstream};
  }
  function paramsAt(info,paramArrays,i,override){
    const p={};for(let k=0;k<info.defs.length;k++){let vi=paramArrays[k][i];if(override&&override.k===k)vi=override.vi;if(vi>=0)p[info.defs[k].id]=domain(info.defs[k])[vi];}return p;
  }
  function maskAt(info,paramArrays,i){const m=new Uint8Array(info.defs.length),p=paramsAt(info,paramArrays,i);for(let k=0;k<info.defs.length;k++)m[k]=activeWhen(info.defs[k].active_when,p)?1:0;return m;}
  const tupleKey=a=>Array.prototype.join.call(a,',');
  function hardKey(info,indices){return info.regimes.map(k=>`${k}:${indices[k]}`).join('|');}
  function family(def){return def.source==='inner'?'tm':def.source==='outer'?'context':'other';}

  function buildTopology(surface){
    const info=descriptorInfo(surface),N=surface.rows*surface.cols;if(!N||!surface.semanticParameterIndices)throw new Error('Semantic parameter indices are missing');
    const paramArrays=info.defs.map(p=>surface.semanticParameterIndices[p.id]);for(let k=0;k<paramArrays.length;k++)if(!paramArrays[k]||paramArrays[k].length!==N)throw new Error(`${info.defs[k].id}: semantic parameter array length mismatch`);
    const present=info.defs.map((p,k)=>{const s=new Set();for(let i=0;i<N;i++)if(paramArrays[k][i]>=0)s.add(paramArrays[k][i]);return [...s].sort((a,b)=>a-b);});
    const presentSet=present.map(a=>new Set(a)),keyMap=new Map(),hardIndex=new Int32Array(N),hardMap=new Map(),hardCells=[];
    const rowTmp=new Int16Array(info.defs.length);
    for(let i=0;i<N;i++){
      for(let k=0;k<info.defs.length;k++)rowTmp[k]=paramArrays[k][i];const key=tupleKey(rowTmp);if(keyMap.has(key))throw new Error(`Duplicate semantic configuration ${key}`);keyMap.set(key,i);
      const hk=hardKey(info,rowTmp);let h=hardMap.get(hk);if(h===undefined){h=hardCells.length;hardMap.set(hk,h);hardCells.push([]);}hardIndex[i]=h;hardCells[h].push(i);
    }
    const orderedLocal=new Map(info.ordered.map((k,j)=>[k,j])),steps=info.ordered.map(()=>({lo:new Int32Array(N),hi:new Int32Array(N),loFib:new Map(),hiFib:new Map()}));for(const s of steps){s.lo.fill(-1);s.hi.fill(-1);}
    const maskCache=new Array(N);const getMask=i=>maskCache[i]||(maskCache[i]=maskAt(info,paramArrays,i));
    let missingExpected=0,fiberStepCount=0;

    function targetPeers(i,k,targetVi){
      const srcMask=getMask(i),base=new Int16Array(info.defs.length);for(let q=0;q<info.defs.length;q++)base[q]=paramArrays[q][i];base[k]=targetVi;
      const dep=[...info.downstream[k]].filter(q=>q!==k),vary=[];
      const probeParams=paramsAt(info,paramArrays,i,{k,vi:targetVi});
      const targetProbe=info.defs.map(def=>activeWhen(def.active_when,probeParams));
      for(const q of dep)if(!srcMask[q]||!targetProbe[q])vary.push(q);
      let combos=[base];
      for(const q of vary){const next=[];for(const a of combos)for(const vi of present[q].length?present[q]:[-1]){const b=new Int16Array(a);b[q]=vi;next.push(b);}combos=next;}
      const peers=[],seen=new Set(),canonical=new Set();
      for(const a0 of combos){
        const a=new Int16Array(a0),p={};for(let q=0;q<info.defs.length;q++)if(a[q]>=0)p[info.defs[q].id]=domain(info.defs[q])[a[q]];
        let valid=true;const tgtMask=new Uint8Array(info.defs.length);
        for(let q=0;q<info.defs.length;q++)tgtMask[q]=activeWhen(info.defs[q].active_when,p)?1:0;
        for(let q=0;q<info.defs.length;q++){
          if(!tgtMask[q])a[q]=-1;
          else if(a[q]<0){valid=false;break;}
          if(q!==k&&srcMask[q]&&tgtMask[q]&&a[q]!==paramArrays[q][i]){valid=false;break;}
        }
        if(!valid)continue;
        if(hardKey(info,a)!==hardKey(info,Array.from({length:info.defs.length},(_,q)=>paramArrays[q][i])))continue;
        const ck=tupleKey(a);if(canonical.has(ck))continue;canonical.add(ck);
        const j=keyMap.get(ck);if(j!==undefined&&!seen.has(j)){seen.add(j);peers.push(j);}
      }
      if(peers.length>1||dep.length)fiberStepCount++;
      return peers;
    }

    for(let i=0;i<N;i++){
      const mask=getMask(i);
      for(const k of info.ordered){
        if(!mask[k])continue;const cur=paramArrays[k][i],loc=orderedLocal.get(k),s=steps[loc];
        for(const delta of [-1,1]){
          const tv=cur+delta;if(tv<0||tv>=domain(info.defs[k]).length||!presentSet[k].has(tv))continue;
          const peers=targetPeers(i,k,tv);if(!peers.length)continue;const arr=delta<0?s.lo:s.hi,fibs=delta<0?s.loFib:s.hiFib;
          arr[i]=peers[0];if(peers.length>1)fibs.set(i,Int32Array.from(peers));
        }
      }
    }
    const counts=new Int32Array(N);let directed=0;
    for(const s of steps)for(let i=0;i<N;i++)for(const [a,m] of [[s.lo,s.loFib],[s.hi,s.hiFib]]){if(a[i]<0)continue;const fib=m.get(i);const n=fib?fib.length:1;counts[i]+=n;directed+=n;}
    const offsets=new Int32Array(N+1);for(let i=0;i<N;i++)offsets[i+1]=offsets[i]+counts[i];const neighbors=new Int32Array(offsets[N]),cursor=offsets.slice(0,N);
    for(const s of steps)for(let i=0;i<N;i++)for(const [a,m] of [[s.lo,s.loFib],[s.hi,s.hiFib]]){if(a[i]<0)continue;const fib=m.get(i);if(fib)for(const j of fib)neighbors[cursor[i]++]=j;else neighbors[cursor[i]++]=a[i];}
    const seen=new Uint8Array(N),queue=new Int32Array(N);let components=0;
    for(let i=0;i<N;i++)if(!seen[i]){components++;let h=0,t=0;queue[t++]=i;seen[i]=1;while(h<t){const u=queue[h++];for(let e=offsets[u];e<offsets[u+1];e++){const v=neighbors[e];if(!seen[v]){seen[v]=1;queue[t++]=v;}}}}
    return {version:VERSION,info,N,paramArrays,present,presentSet,keyMap,hardIndex,hardCells,hardSurfaceCount:hardCells.length,steps,offsets,neighbors,directedEdgeCount:directed,undirectedEdgeCount:directed/2,components,missingExpected,fiberStepCount};
  }

  function robustScales(values,g){
    const out=new Array(g.hardCells.length);for(let h=0;h<g.hardCells.length;h++){const a=[];for(const i of g.hardCells[h])if(finite(values[i]))a.push(values[i]);a.sort((x,y)=>x-y);if(!a.length){out[h]={scale:NaN,flat:false};continue;}const p5=percentileSorted(a,.05),p95=percentileSorted(a,.95),raw=Math.abs(p95-p5),range=Math.abs(a[a.length-1]-a[0]),tol=EPS*Math.max(1,Math.abs(p5),Math.abs(p95),Math.abs(a[0]),Math.abs(a[a.length-1]));if(raw>tol)out[h]={scale:raw,p5,p95,flat:false};else if(range>tol)out[h]={scale:range,p5,p95,flat:false,fallback:true};else out[h]={scale:1,p5,p95,flat:true};}return out;
  }
  function stepValues(values,step,i,side){const a=side<0?step.lo:step.hi,m=side<0?step.loFib:step.hiFib;if(a[i]<0)return null;const fib=m.get(i);if(!fib){const v=values[a[i]];return finite(v)?[v]:null;}const z=[];for(const j of fib)if(finite(values[j]))z.push(values[j]);return z.length?z:null;}
  function mean(a){return a&&a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN;}
  function neighborhoods(g,start,stamp,depth,queue,token){
    const n1=[],n2=[],n3=[];let h=0,t=0;queue[t]=start;depth[t]=0;t++;stamp[start]=token;
    while(h<t){const u=queue[h],d=depth[h];h++;if(d===3)continue;for(let e=g.offsets[u];e<g.offsets[u+1];e++){const v=g.neighbors[e];if(stamp[v]===token)continue;stamp[v]=token;const nd=d+1;queue[t]=v;depth[t]=nd;t++;n3.push(v);if(nd<=2)n2.push(v);if(nd===1)n1.push(v);}}
    return {n1,n2,n3};
  }
  function tvRegion(values,g,ids,scale,flat,regionStamp,token){if(flat)return 0;for(const i of ids)regionStamp[i]=token;let sum=0,n=0;for(const u of ids){const a=values[u];if(!finite(a))continue;for(let e=g.offsets[u];e<g.offsets[u+1];e++){const v=g.neighbors[e];if(v>u&&regionStamp[v]===token){const b=values[v];if(finite(b)){sum+=Math.abs(a-b)/scale;n++;}}}}return n?sum/n:NaN;}
  function computeSR(values,g){
    if(values.length!==g.N)throw new Error('Metric array length does not match semantic topology');const N=g.N,raw={d1:new Float64Array(N),d2:new Float64Array(N),d3:new Float64Array(N),q2:new Float64Array(N),q3:new Float64Array(N),tv1:new Float64Array(N),tv2:new Float64Array(N),k:new Float64Array(N),b2:new Float64Array(N),b3:new Float64Array(N),coverage:new Float64Array(N),directional:Object.create(null)};for(const k of ['d1','d2','d3','q2','q3','tv1','tv2','k','b2','b3','coverage'])raw[k].fill(NaN);
    for(const k of g.info.ordered){const id=g.info.defs[k].id;raw.directional[id]=new Float64Array(N);raw.directional[id].fill(NaN);}
    const scales=robustScales(values,g),stamp=new Int32Array(N),regionStamp=new Int32Array(N),queue=new Int32Array(N),depth=new Uint8Array(N);let tok=0,rtok=0;
    for(let i=0;i<N;i++){
      const z=values[i];if(!finite(z))continue;const rs=scales[g.hardIndex[i]];if(!rs||!finite(rs.scale))continue;const S=rs.scale;tok++;const ns=neighborhoods(g,i,stamp,depth,queue,tok),byR={1:ns.n1,2:ns.n2,3:ns.n3};
      for(const r of [1,2,3]){const diffs=[];for(const j of byR[r]){const v=values[j];if(finite(v))diffs.push(rs.flat?0:Math.abs(z-v)/S);}raw['d'+r][i]=diffs.length?diffs.reduce((a,b)=>a+b,0)/diffs.length:NaN;if(r===2){raw.q2[i]=diffs.length?qFinite(diffs,.90):NaN;raw.b2[i]=diffs.length?diffs.filter(v=>v<=TAU+1e-15).length/diffs.length:NaN;}if(r===3){raw.q3[i]=diffs.length?qFinite(diffs,.90):NaN;raw.b3[i]=diffs.length?diffs.filter(v=>v<=TAU+1e-15).length/diffs.length:NaN;}}
      const valid3=ns.n3.reduce((n,j)=>n+(finite(values[j])?1:0),0);raw.coverage[i]=ns.n3.length?valid3/ns.n3.length:1;
      rtok++;raw.tv1[i]=tvRegion(values,g,[i,...ns.n1],S,rs.flat,regionStamp,rtok);rtok++;raw.tv2[i]=tvRegion(values,g,[i,...ns.n2],S,rs.flat,regionStamp,rtok);
      const ks=[];for(let oi=0;oi<g.info.ordered.length;oi++){const k=g.info.ordered[oi],id=g.info.defs[k].id;if(g.paramArrays[k][i]<0)continue;const st=g.steps[oi],lo=stepValues(values,st,i,-1),hi=stepValues(values,st,i,1),ds=[];if(lo)ds.push(rs.flat?0:Math.abs(z-mean(lo))/S);if(hi)ds.push(rs.flat?0:Math.abs(z-mean(hi))/S);if(ds.length)raw.directional[id][i]=ds.reduce((a,b)=>a+b,0)/ds.length;if(lo&&hi)ks.push(rs.flat?0:Math.abs(mean(lo)-2*z+mean(hi))/S);}raw.k[i]=ks.length?ks.reduce((a,b)=>a+b,0)/ks.length:NaN;
    }
    const norm={d1:midrank(raw.d1,false,0),d2:midrank(raw.d2,false,0),d3:midrank(raw.d3,false,0),q2:midrank(raw.q2,false,0),q3:midrank(raw.q3,false,0),tv1:midrank(raw.tv1,false,0),tv2:midrank(raw.tv2,false,0),k:midrank(raw.k,false,0),b2:midrank(raw.b2,true,1),b3:midrank(raw.b3,true,1),coverage:midrank(raw.coverage,true,1),directional:Object.create(null)};for(const [id,a] of Object.entries(raw.directional))norm.directional[id]=midrank(a,false,0);
    const local=new Float32Array(N),smooth=new Float32Array(N),tm=new Float32Array(N),context=new Float32Array(N),directional=new Float32Array(N),breadth=new Float32Array(N),evidence=new Float32Array(N),sr=new Float32Array(N);
    for(let i=0;i<N;i++){if(!finite(values[i])){for(const a of [local,smooth,tm,context,directional,breadth,evidence,sr])a[i]=NaN;continue;}local[i]=gm([norm.d1[i],norm.d2[i],norm.d3[i],norm.q2[i],norm.q3[i]]);smooth[i]=gm([norm.tv1[i],norm.tv2[i],norm.k[i]]);const tmS=[],ctxS=[],otherS=[];for(const k of g.info.ordered){if(g.paramArrays[k][i]<0)continue;const s=norm.directional[g.info.defs[k].id]?.[i];if(!finite(s))continue;const f=family(g.info.defs[k]);(f==='tm'?tmS:f==='context'?ctxS:otherS).push(s);}tm[i]=gm(tmS);context[i]=gm(ctxS);directional[i]=gm([tm[i],context[i],gm(otherS)]);breadth[i]=gm([norm.b2[i],norm.b3[i]]);evidence[i]=norm.coverage[i];sr[i]=gm([local[i],smooth[i],directional[i],breadth[i],evidence[i]]);}
    return {version:VERSION,tau:TAU,raw,norm,categories:{localSimilarity:local,smoothness:smooth,tmStability:tm,contextStability:context,directionalStability:directional,breadth,evidence},structural_robustness:sr,scales};
  }

  function facetTargetPeers(g,i,k,targetVi){
    const info=g.info,srcMask=maskAt(info,g.paramArrays,i),base=new Int16Array(info.defs.length);for(let q=0;q<info.defs.length;q++)base[q]=g.paramArrays[q][i];base[k]=targetVi;
    const dep=[...info.downstream[k]].filter(q=>q!==k),vary=[];const probe=paramsAt(info,g.paramArrays,i,{k,vi:targetVi}),probeMask=info.defs.map(def=>activeWhen(def.active_when,probe));for(const q of dep)if(!srcMask[q]||!probeMask[q])vary.push(q);
    let combos=[base];for(const q of vary){const next=[];for(const a of combos)for(const vi of g.present[q].length?g.present[q]:[-1]){const b=new Int16Array(a);b[q]=vi;next.push(b);}combos=next;}
    const peers=[],seen=new Set(),canonical=new Set();
    for(const a0 of combos){const a=new Int16Array(a0),p={};for(let q=0;q<info.defs.length;q++)if(a[q]>=0)p[info.defs[q].id]=domain(info.defs[q])[a[q]];const tgtMask=info.defs.map(def=>activeWhen(def.active_when,p));let ok=true;for(let q=0;q<info.defs.length;q++){if(!tgtMask[q])a[q]=-1;else if(a[q]<0){ok=false;break;}if(q!==k&&srcMask[q]&&tgtMask[q]&&a[q]!==g.paramArrays[q][i]){ok=false;break;}}if(!ok||hardKey(info,a)!==hardKey(info,Array.from({length:info.defs.length},(_,q)=>g.paramArrays[q][i])))continue;const ck=tupleKey(a);if(canonical.has(ck))continue;canonical.add(ck);const j=g.keyMap.get(ck);if(j!==undefined&&!seen.has(j)){seen.add(j);peers.push(j);}}
    return {peers,expected:peers.length};
  }
  function computeFR(values,g){
    if(values.length!==g.N)throw new Error('Metric array length does not match semantic topology');const N=g.N,scales=robustScales(values,g),deviation={},coverage={},replication={},facetScore={};let missingExpectedPeers=0,expectedPeers=0,availablePeers=0,eligibleAlternativeCount=0;
    for(const k of g.info.facets){const id=g.info.defs[k].id;deviation[id]=new Float64Array(N);coverage[id]=new Float64Array(N);deviation[id].fill(NaN);coverage[id].fill(NaN);}
    for(let i=0;i<N;i++){
      const z=values[i];if(!finite(z))continue;const rs=scales[g.hardIndex[i]];if(!rs||!finite(rs.scale))continue;
      for(const k of g.info.facets){if(g.paramArrays[k][i]<0)continue;const id=g.info.defs[k].id,current=g.paramArrays[k][i],altMeans=[],altCov=[];for(const vi of g.present[k]){if(vi===current)continue;const fib=facetTargetPeers(g,i,k,vi);if(!fib.expected)continue;eligibleAlternativeCount++;expectedPeers+=fib.expected;const ds=[];for(const j of fib.peers){const v=values[j];if(finite(v)){availablePeers++;ds.push(rs.flat?0:Math.abs(v-z)/rs.scale);}}missingExpectedPeers+=Math.max(0,fib.expected-ds.length);altCov.push(fib.expected?ds.length/fib.expected:1);if(ds.length)altMeans.push(ds.reduce((a,b)=>a+b,0)/ds.length);}if(altMeans.length)deviation[id][i]=altMeans.reduce((a,b)=>a+b,0)/altMeans.length;if(altCov.length)coverage[id][i]=altCov.reduce((a,b)=>a+b,0)/altCov.length;}
    }
    for(const k of g.info.facets){const id=g.info.defs[k].id;replication[id]=midrank(deviation[id],false,0);facetScore[id]=new Float32Array(N);facetScore[id].fill(NaN);for(let i=0;i<N;i++){const r=replication[id][i],c=coverage[id][i];if(finite(r)&&finite(c))facetScore[id][i]=r*Math.min(1,Math.max(0,c));}}
    const fr=new Float32Array(N);fr.fill(NaN);for(let i=0;i<N;i++){if(!finite(values[i]))continue;const s=[];for(const k of g.info.facets){if(g.paramArrays[k][i]<0)continue;const v=facetScore[g.info.defs[k].id][i];if(finite(v))s.push(v);}fr[i]=gm(s);}
    return {version:VERSION,raw:{deviation,coverage,scales,diagnostics:{missingExpectedPeers,expectedPeers,availablePeers,eligibleAlternativeCount}},replication,facetScore,facet_replication:fr};
  }

  function syntheticSuite(){
    const d={descriptor_schema_version:1,study_id:'generic-synth',parameters:[
      {id:'reg',topology_role:'regime',source:'outer',values:[0],active_when:'always'},
      {id:'x',topology_role:'ordered',source:'outer',values:[0,1,2,3],active_when:'always'},
      {id:'f',topology_role:'facet',source:'inner',values:[0,1],active_when:'always'},
      {id:'y',topology_role:'ordered',source:'inner',values:[0,1,2],active_when:{op:'eq',parameter:'f',value:1}}
    ]};
    const rows=[];for(const x of [0,1,3])for(const f of [0,1]){if(f===0)rows.push([0,x,f,-1]);else for(const y of [0,1,2])rows.push([0,x,f,y]);}
    const N=rows.length,idx={};d.parameters.forEach((p,k)=>{idx[p.id]=new Int16Array(N);for(let i=0;i<N;i++)idx[p.id][i]=rows[i][k];});const surface={rows:N,cols:1,semanticDescriptor:d,semanticParameterIndices:idx},g=buildTopology(surface),values=Float64Array.from(rows.map(r=>r[1]+r[2]*.1+(r[3]<0?0:r[3]*.01))),fr=computeFR(values,g),sr=computeSR(values,g);const xk=1;let fakeGap=true;for(let i=0;i<N;i++)if(g.paramArrays[xk][i]===1){const st=g.steps[0];const hi=st.hi[i];if(hi>=0&&g.paramArrays[xk][hi]===3)fakeGap=false;}
    const perm=Array.from({length:N},(_,i)=>(i*7)%N);if(new Set(perm).size!==N)throw new Error('Synthetic permutation is not bijective');const pidx={};d.parameters.forEach(p=>pidx[p.id]=Int16Array.from(perm.map(i=>idx[p.id][i])));const pg=buildTopology({rows:N,cols:1,semanticDescriptor:d,semanticParameterIndices:pidx}),psr=computeSR(Float64Array.from(perm.map(i=>values[i])),pg).structural_robustness,pfr=computeFR(Float64Array.from(perm.map(i=>values[i])),pg).facet_replication,inv=new Int32Array(N);perm.forEach((old,n)=>inv[old]=n);let ds=0,df=0;for(let i=0;i<N;i++){ds=Math.max(ds,Math.abs(sr.structural_robustness[i]-psr[inv[i]]));df=Math.max(df,Math.abs(fr.facet_replication[i]-pfr[inv[i]]));}
    return {passed:fakeGap&&ds<1e-7&&df<1e-7,tests:{filteredGapPreserved:fakeGap,srPermutationDiff:ds,frPermutationDiff:df},summary:{hardSurfaces:g.hardSurfaceCount,components:g.components,edges:g.undirectedEdgeCount}};
  }

  const API={VERSION,TAU,DRIVER_METRICS,buildTopology,computeSR,computeFR,runSyntheticSuite:syntheticSuite};root.SurfaceSemanticAnalysisV030=API;if(typeof module!=='undefined'&&module.exports)module.exports=API;

  if(typeof window==='undefined')return;
  function installBrowser(){
    if(typeof setMetric!=='function'||typeof setMode!=='function'||typeof updateRobustnessAvailability!=='function'||typeof meta==='undefined'||!meta||!root.SurfaceFilterV029){setTimeout(installBrowser,25);return;}
    const acceptance=syntheticSuite();let graphSurface=null,graph=null,lastFacetKey='fr:r_per_trade',activeFacetResult=null,analysisCache=new Map();
    const srKey=k=>`sr:${k}`,frKey=k=>`fr:${k}`,driver=k=>k&&/^(sr|fr):/.test(k)?k.slice(3):null;
    for(const k of DRIVER_METRICS){robustnessKeys.add(srKey(k));robustnessKeys.add(frKey(k));meta[srKey(k)]={label:meta[k]?.label||k,lo:0,hi:1,invert:false,decimals:3,group:'robustness'};meta[frKey(k)]={label:meta[k]?.label||k,lo:0,hi:1,invert:false,decimals:3,group:'facet_replication'};}
    function isSemantic(){return !!activeSurface?.semanticDescriptor&&!!activeSurface?.semanticParameterIndices;}
    function ensureGraph(){if(!isSemantic())return null;if(graphSurface!==activeSurface){graph=buildTopology(activeSurface);graphSurface=activeSurface;}return graph;}
    const basePopulate=populateMetricOptions;populateMetricOptions=function(mode){if(!isSemantic()||(mode!=='robustness'&&mode!=='facet'))return basePopulate(mode);metricSel.innerHTML='';for(const k of DRIVER_METRICS){if(!activeSurface.metrics[k])continue;const key=mode==='robustness'?srKey(k):frKey(k),o=document.createElement('option');o.value=key;o.textContent=meta[k]?.label||k;metricSel.appendChild(o);}};
    const baseSetView=setViewForMode;setViewForMode=function(mode){if(isSemantic()&&(mode==='robustness'||mode==='facet')){lastPerformanceView=viewSel.value;viewSel.innerHTML='<option value="raw">Score</option>';viewSel.value='raw';return;}return baseSetView(mode);};
    const baseDisplayQ=displayQ;displayQ=function(i){if(isSemantic()&&(currentMode==='robustness'||currentMode==='facet')&&driver(currentKey))return Math.round(clamp01(values[i])*15);return baseDisplayQ(i);};
    const baseRobustApprox=robustApprox;robustApprox=function(q){if(isSemantic()&&(currentMode==='robustness'||currentMode==='facet')&&driver(currentKey))return Number(q);return baseRobustApprox(q);};
    const baseSetMetric=setMetric;setMetric=async function(key){
      if(!isSemantic()||!driver(key))return baseSetMetric(key);const metric=driver(key),isFr=key.startsWith('fr:');currentKey=key;lastPerformanceKey=metric;if(isFr)lastFacetKey=key;else lastRobustnessKey=key;loading.style.display='flex';loading.textContent=`Calculating ${meta[metric]?.label||metric}…`;
      try{await new Promise(r=>setTimeout(r,0));const g=ensureGraph(),src=activeSurface.metrics[metric];if(!src)throw new Error(`Surface does not contain ${metric}`);const cacheKey=`${isFr?'fr':'sr'}:${metric}`;let result=analysisCache.get(cacheKey);if(!result){if(isFr){const full=computeFR(src,g);result={facet_replication:full.facet_replication,facetScore:full.facetScore,diagnostics:full.raw.diagnostics};}else{const full=computeSR(src,g);result={structural_robustness:full.structural_robustness};}analysisCache.set(cacheKey,result);}if(isFr){activeFacetResult=result;values=result.facet_replication;}else{activeFacetResult=null;values=result.structural_robustness;}currentStats=null;loading.style.display='none';const d=isFr?result.diagnostics:null;statusEl.textContent=isFr?`Facet Replication · ${g.hardSurfaceCount} hard surfaces · ${g.info.facets.length} descriptor facets · ${d.missingExpectedPeers} missing expected peers · generic topology v030`:`Structural Robustness · ${g.hardSurfaceCount} hard surfaces · ${g.components.toLocaleString()} facet components · ${g.undirectedEdgeCount.toLocaleString()} semantic edges · generic topology v030`;draw();}
      catch(e){loading.style.display='flex';loading.textContent=`Could not calculate ${isFr?'facet replication':'robustness'}: ${e.message}`;statusEl.textContent=`${isFr?'Facet Replication':'Structural Robustness'} failed`;console.error(e);}
    };
    function syncFilterControl(){const b=document.querySelector('#surfaceFilterControl .sa-filter-btn');if(b)b.disabled=!isSemantic()||currentMode!=='performance';const note=document.querySelector('#surfaceFilterControl .sa-filter-note');if(note)note.textContent='Filtering defines the current semantic analysis domain. Performance, Structural Robustness and Facet Replication all use the filtered domain; removed ordered values never collapse declared semantic distance.';}
    const filterButton=document.querySelector('#surfaceFilterControl .sa-filter-btn');if(filterButton)filterButton.addEventListener('click',()=>setTimeout(syncFilterControl,0));
    const baseSetMode=setMode;setMode=async function(mode){if(!isSemantic())return baseSetMode(mode);if(mode===currentMode){syncFilterControl();return;}if(currentMode==='performance'){lastPerformanceKey=currentKey;lastPerformanceView=viewSel.value;}else if(currentMode==='facet')lastFacetKey=currentKey;else lastRobustnessKey=currentKey;currentMode=mode;for(const b of metricMode.querySelectorAll('button'))b.classList.toggle('on',b.dataset.mode===mode);setViewForMode(mode);populateMetricOptions(mode);syncFilterControl();if(mode==='facet')readCopy.innerHTML='Facet Replication changes <b>one descriptor facet at a time</b>, preserves shared active coordinates, drops coordinates that become inactive, and spans currently materialized values of newly active coordinates. Alternatives are equally weighted after averaging within each substitution fiber. Facet changes never create Structural Robustness edges.';else if(mode==='robustness')readCopy.innerHTML='Structural Robustness runs on the <b>descriptor-defined semantic graph</b>, not heatmap adjacency. Regime values hard-split topology; only one-step moves in the original declared ordered domains create edges. Filtering removes nodes without collapsing declared semantic distance. Auto Format and axis presentation do not define topology.';else readCopy.innerHTML=performanceRead;let next;if(mode==='facet')next=driver(lastFacetKey)?lastFacetKey:frKey(lastPerformanceKey||'r_per_trade');else if(mode==='robustness')next=srKey(lastPerformanceKey||'r_per_trade');else next=lastPerformanceKey;metricSel.value=next;await setMetric(next);};
    const baseUpdate=updateRobustnessAvailability;updateRobustnessAvailability=function(){baseUpdate();if(!isSemantic())return;const ok=acceptance.passed,msg=ok?'Generic descriptor-driven SR/FR. Topology validates on first use.':'Generic semantic-analysis acceptance suite failed.';for(const mode of ['robustness','facet']){const b=metricMode.querySelector(`button[data-mode="${mode}"]`);if(b){b.disabled=!ok;b.title=msg;}}syncFilterControl();};
    const baseActivate=activateSurface;activateSurface=async function(surface,opt){
      const input=isSemantic()&&currentMode!=='performance'&&surface===activeSurface&&surface?.surfaceFilter?.active?{...surface}:surface;
      const out=await baseActivate(input,opt);graphSurface=null;graph=null;analysisCache=new Map();activeFacetResult=null;updateRobustnessAvailability();return out;
    };
    updateRobustnessAvailability();syncFilterControl();const v=document.querySelector('.version');if(v)v.textContent='v030';root.SurfaceSemanticAnalysisBrowserV030={acceptance,get graph(){return graph;}};
  }
  installBrowser();
})(typeof window!=='undefined'?window:globalThis);
