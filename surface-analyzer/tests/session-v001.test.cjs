'use strict';
const assert=require('node:assert/strict');
const Session=require('../session-v001.js');

let topologyCalls=0,srCalls=0,frCalls=0,scanCalls=0,rrCalls=0;
const semanticEngine={
  buildTopology(surface){topologyCalls++;return {N:surface.rows*surface.cols,hardSurfaceCount:1,components:1,undirectedEdgeCount:3};},
  computeSR(values){srCalls++;return {structural_robustness:Float32Array.from(values,v=>v/10)};},
  computeFR(values){frCalls++;return {facet_replication:Float32Array.from(values,v=>v/20)};}
};
const scanEngine={
  midrankPercentile(values,invert){return Float32Array.from(values,(v,i)=>invert?100-i*25:i*25);},
  async evaluateScan(surface,config,graph,resolver){scanCalls++;const a=await resolver(config.criteria[0]);return {mask:Uint8Array.from(a,()=>1),performanceMask:Uint8Array.from(a,()=>1),performanceMetrics:[config.criteria[0].metric],passingCells:a.length,totalCells:a.length,regions:[]};},
  analyzeRegionalRobustness(surface,graph,mask,minCells,metricIds,invert){rrCalls++;return {mask,regions:[{region_id:1,cell_count:mask.length}],performance_metrics:metricIds,inverted:invert(metricIds[0])};}
};
const metadata={loss:{invert:true}};
const base={rows:1,cols:4,metrics:{score:Float64Array.from([1,2,3,4]),loss:Float64Array.from([4,3,2,1])},semanticDescriptor:{study_id:'test'}};
const filtered={rows:1,cols:2,metrics:{score:Float64Array.from([2,3]),loss:Float64Array.from([3,2])},semanticDescriptor:base.semanticDescriptor};

(async()=>{
  const events=[];
  const s=Session.createSession({semanticEngine,scanEngine,metricMetadata:metadata,filterAdapter:{apply:async()=>filtered}});
  s.subscribe(e=>events.push(e.type));
  await s.loadSurface(base);
  assert.equal(s.getState().domainRevision,1);
  assert.equal(s.getState().researchDomain.filtered,false);

  const sr1=s.computeStructuralRobustness('score'),sr2=s.computeStructuralRobustness('score');
  assert.equal(sr1,sr2);assert.equal(topologyCalls,1);assert.equal(srCalls,1);
  const fr1=s.computeFacetReplication('score'),fr2=s.computeFacetReplication('score');
  assert.equal(fr1,fr2);assert.equal(frCalls,1);assert.equal(topologyCalls,1);

  const pct=s.getPerformanceSeries('loss',{basis:'percentile'});
  assert.deepEqual(Array.from(pct),[100,75,50,25]);

  const scan=await s.runScan({criteria:[{source:'performance',metric:'score',basis:'raw'}]});
  assert.equal(scanCalls,1);assert.equal(scan.passingCells,4);assert.equal(s.getState().scan.active,true);
  const rr=s.runRegionalRobustness({minCells:2});
  assert.equal(rrCalls,1);assert.equal(rr.inverted,false);assert.equal(s.getState().regionalRobustness.active,true);

  await s.setFilter({x:[1,2]});
  assert.equal(s.getState().domainRevision,2);
  assert.equal(s.getState().researchDomain.filtered,true);
  assert.equal(s.getState().scan.active,false);
  assert.deepEqual(s.getState().cachedStructuralRobustness,[]);
  assert.deepEqual(s.getState().cachedFacetReplication,[]);
  s.computeStructuralRobustness('score');
  assert.equal(topologyCalls,2);assert.equal(srCalls,2);

  s.clearFilter();
  assert.equal(s.getState().domainRevision,3);
  assert.equal(s.getState().researchDomain.filtered,false);
  assert.equal(s.getState().topology,null);

  assert.ok(events.includes('surfaceLoaded'));
  assert.ok(events.includes('domainChanged'));
  assert.ok(events.includes('scanCompleted'));
  assert.ok(events.includes('regionalRobustnessComputed'));
  console.log('PASS  SurfaceAnalyzerSession v001 state ownership and invalidation');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
