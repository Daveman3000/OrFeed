'use strict';

const assert=require('node:assert/strict');
const Evidence=require('../node/pressure-test-shoulder-evidence-v001.cjs');

const descriptor={
  descriptor_schema_version:1,
  study_id:'shoulder-evidence-test',
  parameters:[
    {id:'regime',topology_role:'regime',values:[1],active_when:'always'},
    {id:'family',topology_role:'facet',values:['a'],active_when:'always'},
    {id:'x',topology_role:'ordered',values:[10,20,30],active_when:'always'}
  ],
  layout:{x_parameter_order:['x'],y_parameter_order:['regime','family']},
  results:{
    metrics:['r_per_trade','profit_factor','win_pct','max_drawdown_r','total_r'],
    support_fields:[{id:'trades',type:'integer',role:'sample_support'}]
  }
};
const surface={
  rows:1,cols:3,semanticDescriptor:descriptor,
  metrics:{
    r_per_trade:Float64Array.from([.1,.2,.4]),
    profit_factor:Float64Array.from([1.1,1.2,1.5]),
    win_pct:Float64Array.from([50,48,42]),
    max_drawdown_r:Float64Array.from([3,4,6]),
    total_r:Float64Array.from([10,20,30])
  },
  supportFields:{trades:Int32Array.from([100,90,80])},
  semanticParameterIndices:{
    regime:Int16Array.from([0,0,0]),
    family:Int16Array.from([0,0,0]),
    x:Int16Array.from([0,1,2])
  }
};

const report=Evidence.analyzeSurface(surface,{surfaceId:'s'});
assert.equal(report.report_type,'shoulder_evidence_v001');
assert.equal(report.families.length,1);
const max=report.families[0].ordered_edges['x:max'];
assert.equal(max.supported,true);
assert.deepEqual(max.levels.map(v=>v.value),[10,20,30]);
assert.deepEqual(max.levels.map(v=>v.metrics.r_per_trade.median),[.1,.2,.4]);
assert.deepEqual(max.levels.map(v=>v.support_fields.trades.median),[100,90,80]);
assert.equal(max.deltas.r_per_trade.edge_minus_two_in,.30000000000000004);
assert.equal(max.deltas.win_pct.edge_minus_two_in,-8);
const min=report.families[0].ordered_edges['x:min'];
assert.deepEqual(min.levels.map(v=>v.value),[30,20,10]);
assert.equal(report.semantics.classification,null);
console.log('PASS  shoulder evidence reports canonical metrics/support without inventing classification thresholds');
