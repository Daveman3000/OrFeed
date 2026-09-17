'use strict';
const assert=require('node:assert/strict');
const core=require('../core/surface-analyzer-session-v001.js');
const filter=require('../core/surface-filter-engine-v001.js');
const compat=require('../session-core-compat-v001.js');

const surface={
  rows:1,cols:2,
  metrics:{m:Float64Array.from([1,2])},
  semanticDescriptor:{
    descriptor_schema_version:1,study_id:'compat-test',
    parameters:[{id:'x',topology_role:'ordered',values:[0,1],active_when:'always'}],
    layout:{x_parameter_order:['x'],y_parameter_order:[]}
  },
  semanticAxis:{x:[{x:0},{x:1}],y:[{}]},
  semanticParameterIndices:{x:Int16Array.from([0,1])}
};
const topology={hardSurfaceCount:1,components:1,undirectedEdgeCount:1};
const semanticEngine={
  TAU:.1,
  buildTopology(){return topology;},
  computeSR(values){return {structural_robustness:Float32Array.from(values)};},
  computeFR(values){return {facet_replication:Float32Array.from(values)};}
};
let rrCalls=0;
const scanEngine={
  midrankPercentile(values){return Float32Array.from(values);},
  async evaluateScan(s,config){
    return {
      mask:Uint8Array.from([1,1]),regionId:Int32Array.from([0,0]),regions:[],passingCells:2,totalCells:2,
      criteria:config.criteria,performanceMask:Uint8Array.from([1,0]),performanceMetrics:['m'],performanceCriteriaCount:1
    };
  },
  analyzeRegionalRobustness(s,g,mask){
    rrCalls++;
    assert.deepEqual(Array.from(mask),[1,0]);
    return {mask:Uint8Array.from([1,0]),regionId:Int32Array.from([0,-1]),regions:[],performance_metrics:['m']};
  }
};

(async()=>{
  const s=compat.wrapSession(core,filter,{semanticEngine,scanEngine,metricMetadata:{m:{invert:false}}});
  await s.loadSurface(surface);
  assert.equal(s.getState().source.loaded,true);
  assert.equal(s.getState().researchDomain.filtered,false);
  assert.strictEqual(s.getAnalysisSnapshot().sourceSurface,surface);

  s.setFilter({x:[1]});
  assert.equal(s.getState().researchDomain.filtered,true);
  assert.equal(s.getAnalysisSnapshot().researchSurface.cols,1);
  s.clearFilter();
  assert.strictEqual(s.getAnalysisSnapshot().researchSurface,surface);

  const config={criteria:[{id:'p',source:'performance',metric:'m',basis:'raw',operator:'>=',value:1}],region_rules:{min_cells:1,regional_robustness:true}};
  const result=await s.runScan(config);
  assert.deepEqual(Array.from(result.performanceMask),[1,0],'browser compatibility layer must restore the canonical Performance mask only for legacy presentation plumbing');
  assert.equal(rrCalls,1,'Regional Robustness must still execute exactly once inside the canonical core session');
  assert.strictEqual(s.runRegionalRobustness(),s.getAnalysisSnapshot().regionalRobustness,'legacy RR accessor must reuse the canonical RR result, not recompute it');
  assert.equal(s.getState().scan.active,true);
  s.clearScan();
  assert.equal(s.getState().scan.active,false);
  assert.deepEqual(s.getState().scan.config,config,'Clear Applied must retain the canonical Scan configuration');
  assert.ok(s.getCanonicalSession(),'compatibility adapter must expose the underlying canonical session for migration/debugging');

  console.log('PASS  browser compatibility adapter delegates state/filter/Scan/RR ownership to canonical core session');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
