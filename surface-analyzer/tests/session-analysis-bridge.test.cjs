'use strict';
const assert=require('node:assert/strict');
const bridge=require('../session-analysis-bridge-v001.js');

const descriptor={parameters:[{id:'a'},{id:'b'}]};
const research={rows:2,cols:2,semanticDescriptor:descriptor,semanticParameterIndices:{a:Int16Array.from([0,0,1,1]),b:Int16Array.from([0,1,0,1])}};
const display={rows:2,cols:2,semanticDescriptor:descriptor,semanticParameterIndices:{a:Int16Array.from([1,1,0,0]),b:Int16Array.from([0,1,0,1])}};
const same={rows:2,cols:2,semanticDescriptor:descriptor,semanticParameterIndices:{a:Int16Array.from([0,0,1,1]),b:Int16Array.from([0,1,0,1])}};
const sr=Float32Array.from([1,2,3,4]);
const fr=Float32Array.from([5,6,7,8]);

assert.equal(bridge.remapSeries(research,same,sr),sr,'matching semantic order should reuse the canonical series');
assert.deepEqual(Array.from(bridge.remapSeries(research,display,sr)),[3,4,1,2]);

let srCalls=0,frCalls=0;
const topology={hardSurfaceCount:1,info:{facets:[0]},components:1,undirectedEdgeCount:2};
const session={
  computeStructuralRobustness(metric){srCalls++;assert.equal(metric,'m');return {structural_robustness:sr};},
  computeFacetReplication(metric){frCalls++;assert.equal(metric,'m');return {facet_replication:fr,raw:{diagnostics:{missingExpectedPeers:0}}};},
  getAnalysisSnapshot(){return {researchSurface:research,topology};}
};

const srOut=bridge.computeForDisplay(session,display,'sr:m');
const frOut=bridge.computeForDisplay(session,display,'fr:m');
assert.equal(srCalls,1);assert.equal(frCalls,1);
assert.deepEqual(Array.from(srOut.values),[3,4,1,2]);
assert.deepEqual(Array.from(frOut.values),[7,8,5,6]);
assert.equal(bridge.computeForDisplay(session,display,'m'),null);

console.log('PASS  session SR/FR results remap from canonical research order into presentation order');
