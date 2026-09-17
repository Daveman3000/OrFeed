'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const analysis=require('../session-analysis-bridge-v001.js');
const bridge=require('../session-scan-bridge-v001.js');

(async()=>{
  const descriptor={parameters:[{id:'x'}]};
  const research={rows:2,cols:2,semanticDescriptor:descriptor,semanticParameterIndices:{x:Int16Array.from([0,1,2,3])}};
  const display={rows:2,cols:2,semanticDescriptor:descriptor,semanticParameterIndices:{x:Int16Array.from([2,0,3,1])}};
  const canonical={
    mask:Uint8Array.from([1,0,1,0]),
    regionId:Int32Array.from([0,-1,1,-1]),
    performanceMask:Uint8Array.from([1,1,0,0]),
    regions:[{region_id:1,cell_count:1},{region_id:2,cell_count:1}],
    passingCells:2,totalCells:4,performanceMetrics:['r_per_trade'],performanceCriteriaCount:1
  };
  const rr={mask:Uint8Array.from([1,1,0,0]),regionId:Int32Array.from([0,0,-1,-1]),regions:[{region_id:1,cell_count:2}],performance_metrics:['r_per_trade']};
  let scanCalls=0,rrCalls=0;
  const session={
    async runScan(config){scanCalls++;assert.equal(config.criteria[0].source,'performance');return canonical;},
    runRegionalRobustness(args){rrCalls++;assert.equal(args.minCells,2);assert.deepEqual(args.metricIds,['r_per_trade']);assert.equal(args.tau,.1);return rr;},
    getAnalysisSnapshot(){return {researchSurface:research,scanResult:canonical,regionalRobustness:rr};},
    clearScan(){}
  };
  const config={criteria:[{source:'performance',metric:'r_per_trade',basis:'raw',operator:'>=',value:.2}],region_rules:{min_cells:2,regional_robustness:true}};
  const out=await bridge.runForDisplay(session,display,config,{tau:.1,remap:analysis.remapSeries});
  assert.equal(scanCalls,1);assert.equal(rrCalls,1);assert.equal(bridge.isApplied(),true);
  assert.deepEqual(Array.from(out.mask),[1,1,0,0]);
  assert.deepEqual(Array.from(out.regionId),[1,0,-1,-1]);
  assert.equal('performanceMask' in out,false);
  assert.deepEqual(Array.from(out.regionalRobustness.mask),[0,1,0,1]);
  assert.deepEqual(Array.from(out.regionalRobustness.regionId),[-1,0,-1,0]);
  const current=bridge.getCurrentForDisplay(session,display,{remap:analysis.remapSeries});
  assert.deepEqual(Array.from(current.mask),[1,1,0,0]);

  const refreshed=await bridge.refreshApplied(session,display,config,{tau:.1,remap:analysis.remapSeries});
  assert.equal(scanCalls,2);assert.equal(rrCalls,2);assert.deepEqual(Array.from(refreshed.mask),[1,1,0,0]);
  bridge.clearApplied();
  assert.equal(bridge.isApplied(),false);
  assert.equal(bridge.getCurrentForDisplay(session,display,{remap:analysis.remapSeries}),null);

  const legacy=fs.readFileSync(path.join(__dirname,'..','scan-layer-v033.js'),'utf8');
  const patched=bridge.patchLegacySource(legacy);
  assert.match(patched,/SurfaceSessionScanBridgeV001\.runForDisplay/);
  assert.match(patched,/SurfaceSessionScanBridgeV001\?\.clearApplied/);
  assert.match(patched,/SurfaceSessionScanBridgeV001\.refreshApplied/,'surface changes must rerun the active Scan instead of clearing it');
  assert.match(patched,/SurfaceSessionScanBridgeV001\?\.isApplied/,'sticky rerun must remain gated by applied state');
  assert.match(patched,/const opening=!wrap\.classList\.contains\('open'\)/);
  assert.match(patched,/renderMenu\(false\);wrap\.classList\.add\('open'\)/,'Apply must leave Scan open');
  assert.doesNotMatch(patched,/scanLayerControl[^\n]*remove\('open'\)/,'internal Scan actions must not close Scan');
  assert.doesNotMatch(patched,/textContent='Scanning…'/,'Apply must not move the Scan popover anchor by changing button text');

  const bridgeSource=fs.readFileSync(path.join(__dirname,'..','session-scan-bridge-v001.js'),'utf8');
  assert.match(bridgeSource,/document\.addEventListener\('click',e=>\{/,'menu exclusivity must be delegated at the document level');
  assert.match(bridgeSource,/#surfaceFilterControl,#axisLayerControl,#scanLayerControl/,'all three custom menus must share the one-open rule');
  assert.match(bridgeSource,/addEventListener\('click',e=>\{[\s\S]*\},true\)/,'menu exclusivity must run in capture phase');
  console.log('PASS  Scan Layer delegates execution to session, remaps presentation order, stays applied across surface changes, preserves menu-open rule, and keeps one stable menu anchor');
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
