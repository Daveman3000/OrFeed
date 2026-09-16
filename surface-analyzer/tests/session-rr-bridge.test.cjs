'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const bridge=require('../session-rr-bridge-v001.js');

const display={rows:2,cols:2,semanticDescriptor:{parameters:[{id:'x'}]},semanticParameterIndices:{x:Int16Array.from([0,1,2,3])}};
const expected={mask:Uint8Array.from([1,0,1,0]),regionalRobustness:{regions:[{region_id:1}]}};
let calls=0;
const session={getAnalysisSnapshot(){return {scanConfig:{display:{dim_nonpassing:true}}};}};
const scanBridge={getCurrentForDisplay(s,d){calls++;assert.equal(s,session);assert.equal(d,display);return expected;}};
const state=bridge.presentationState({sessionInstance:session,display,scanBridge});
assert.equal(calls,1);assert.equal(state.result,expected);assert.deepEqual(state.config,{display:{dim_nonpassing:true}});

const rr=fs.readFileSync(path.join(__dirname,'..','rr-presentation-v036.js'),'utf8');
const labels=fs.readFileSync(path.join(__dirname,'..','rr-fragment-labels-v037.js'),'utf8');
const pr=bridge.patchPresentationSource(rr),pl=bridge.patchLabelsSource(labels);
assert.match(pr,/SurfaceSessionRrBridgeV001\?\.presentationState/);
assert.match(pr,/SurfaceSessionRrBridgeV001\?\.bind/);
assert.match(pr,/forceSync:\(\)=>\{lastResult=null;lastMenuResult=null;sync\(\);\}/);
assert.doesNotMatch(pr,/setInterval\(sync,200\)/);
assert.match(pl,/SurfaceSessionRrBridgeV001\?\.presentationState/);
assert.match(pl,/SurfaceRrPresentationV036\?\.forceSync/);
assert.match(pl,/SurfaceSessionRrBridgeV001\?\.bind/);
assert.doesNotMatch(pl,/setInterval\(drawExtraLabels,250\)/);
console.log('PASS RR presentation is session-sourced, event-driven, and extra labels repaint from the current RR result');
