'use strict';

const assert=require('node:assert/strict');
const semantic=require('../semantic-analysis-v030.js');
const scan=require('../scan-layer-v033.js');
const Session=require('../session-v001.js');

function buildSurface(){
  const descriptor={
    descriptor_schema_version:1,
    study_id:'session-equivalence',
    parameters:[
      {id:'reg',topology_role:'regime',source:'outer',values:[0],active_when:'always'},
      {id:'x',topology_role:'ordered',source:'outer',values:[0,1,2,3],active_when:'always'},
      {id:'f',topology_role:'facet',source:'inner',values:[0,1],active_when:'always'},
      {id:'y',topology_role:'ordered',source:'inner',values:[0,1,2],active_when:{op:'eq',parameter:'f',value:1}}
    ]
  };
  const rows=[];
  for(const x of [0,1,3])for(const f of [0,1]){
    if(f===0)rows.push([0,x,f,-1]);
    else for(const y of [0,1,2])rows.push([0,x,f,y]);
  }
  const indices={};
  descriptor.parameters.forEach((p,k)=>{indices[p.id]=Int16Array.from(rows.map(r=>r[k]));});
  const metric=Float64Array.from(rows.map(r=>r[1]+r[2]*.1+(r[3]<0?0:r[3]*.01)));
  return {rows:rows.length,cols:1,semanticDescriptor:descriptor,semanticParameterIndices:indices,metrics:{r_per_trade:metric}};
}

function assertFloatArrayEqual(actual,expected,tolerance=0){
  assert.equal(actual.length,expected.length);
  for(let i=0;i<actual.length;i++){
    const a=actual[i],b=expected[i];
    if(Number.isNaN(a)||Number.isNaN(b)){assert.ok(Number.isNaN(a)&&Number.isNaN(b),`NaN mismatch at ${i}`);continue;}
    assert.ok(Math.abs(a-b)<=tolerance,`value mismatch at ${i}: ${a} vs ${b}`);
  }
}

(async()=>{
  const surface=buildSurface(),metric=surface.metrics.r_per_trade,directGraph=semantic.buildTopology(surface);
  const directSr=semantic.computeSR(metric,directGraph);
  const directFr=semantic.computeFR(metric,directGraph);
  const session=Session.createSession({semanticEngine:semantic,scanEngine:scan,metricMetadata:{r_per_trade:{invert:false}}});
  await session.loadSurface(surface);

  const sessionSr=session.computeStructuralRobustness('r_per_trade');
  const sessionFr=session.computeFacetReplication('r_per_trade');
  assertFloatArrayEqual(sessionSr.structural_robustness,directSr.structural_robustness,0);
  assertFloatArrayEqual(sessionFr.facet_replication,directFr.facet_replication,0);

  const config={
    criteria:[
      {id:'p',enabled:true,source:'performance',metric:'r_per_trade',basis:'raw',operator:'>=',value:.5},
      {id:'sr',enabled:true,source:'structural_robustness',metric:'r_per_trade',basis:'score',operator:'>=',value:.2}
    ],
    region_rules:{min_cells:1}
  };
  const directScan=await scan.evaluateScan(surface,config,directGraph,async c=>{
    if(c.source==='performance')return metric;
    if(c.source==='structural_robustness')return directSr.structural_robustness;
    throw new Error('unexpected criterion');
  });
  const sessionScan=await session.runScan(config);
  assert.deepEqual(Array.from(sessionScan.mask),Array.from(directScan.mask));
  assert.deepEqual(Array.from(sessionScan.regionId),Array.from(directScan.regionId));
  assert.equal(sessionScan.passingCells,directScan.passingCells);
  assert.deepEqual(sessionScan.regions,directScan.regions);

  const directRr=scan.analyzeRegionalRobustness(surface,directGraph,directScan.performanceMask,1,['r_per_trade'],()=>false,semantic.TAU);
  const sessionRr=session.runRegionalRobustness({minCells:1,tau:semantic.TAU});
  assert.deepEqual(Array.from(sessionRr.mask),Array.from(directRr.mask));
  assert.deepEqual(Array.from(sessionRr.regionId),Array.from(directRr.regionId));
  assert.deepEqual(sessionRr.regions,directRr.regions);

  console.log('PASS  SurfaceAnalyzerSession delegates exactly to semantic/scanner engines');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
