'use strict';

const assert=require('node:assert/strict');
const core=require('../surface-package-core-v001.js');

const descriptor={
  descriptor_schema_version:1,
  study_id:'package-core-test',
  parameters:[
    {id:'mode',type:'enum',source:'outer',topology_role:'regime',values:[0,1],active_when:'always'},
    {id:'threshold_a',type:'number',source:'outer',topology_role:'ordered',values:['',10,20],active_when:{op:'eq',parameter:'mode',value:0}},
    {id:'threshold_b',type:'number',source:'outer',topology_role:'ordered',values:[30,40],active_when:{op:'eq',parameter:'mode',value:1}},
    {id:'facet',type:'enum',source:'inner',topology_role:'facet',values:[0,1],active_when:'always'},
    {id:'x',type:'integer',source:'inner',topology_role:'ordered',values:[1,2],active_when:'always'}
  ],
  layout:{
    x_parameter_order:['facet','x'],
    y_parameter_order:['mode','threshold_a','threshold_b'],
    virtual_slots:[{id:'active_threshold',axis:'y',after:'mode',parameters:['threshold_a','threshold_b']}]
  },
  results:{metrics:['r_per_trade']},
  experiment_constants:[{id:'constant',type:'integer',value:7}],
  provenance:{source_row_count:16}
};

const header='analysis_key,mode,threshold_a,threshold_b,facet,x,r_per_trade,constant';
const rows=[];
let n=0;
for(const mode of [1,0]){
  const thresholds=mode===0?['',10,20]:[30,40];
  for(const t of thresholds)for(const facet of [1,0])for(const x of [2,1]){
    if(rows.length>=16)break;
    const a=mode===0?t:'';
    const b=mode===1?t:'';
    rows.push([`k${n++}`,mode,a,b,facet,x,(mode*100+(Number(t)||0)+facet*10+x).toFixed(3),7].join(','));
  }
}
rows.length=16;
descriptor.provenance.source_row_count=16;
const csv=[header,...rows].join('\n')+'\n';
const surface=core.buildSemanticSurface(csv,descriptor,{name:'fixture.surface.zip',size:123},{requiredMetrics:['r_per_trade']});
assert.equal(surface.packageKind,'semantic-surface-v1');
assert.equal(surface.fileName,'fixture.surface.zip');
assert.equal(surface.rows*surface.cols,16);
assert.equal(surface.metrics.r_per_trade.length,16);
assert.equal(surface.semanticParameterIndices.threshold_a.length,16);
assert.ok(Array.from(surface.semanticParameterIndices.threshold_a).some(v=>v===0),'descriptor-declared blank value must remain a valid active value index');
assert.ok(Array.from(surface.semanticParameterIndices.threshold_b).some(v=>v===-1),'inactive conditional parameter must remain -1');

const duplicate=csv.replace('k1,','k0,');
assert.throws(()=>core.buildSemanticSurface(duplicate,descriptor,{},{requiredMetrics:['r_per_trade']}),/duplicate analysis_key/);
const badInactive=csv.replace(/,1,,30,/,',1,10,30,');
assert.throws(()=>core.buildSemanticSurface(badInactive,descriptor,{},{requiredMetrics:['r_per_trade']}),/inactive parameter threshold_a must be blank/);
assert.throws(()=>core.buildSemanticSurface(csv,{...descriptor,descriptor_schema_version:2},{},{requiredMetrics:['r_per_trade']}),/descriptor_schema_version 1/);


const winDescriptor=JSON.parse(JSON.stringify(descriptor));
winDescriptor.results.passthrough_results=['win_pct'];
const winHeader='analysis_key,mode,threshold_a,threshold_b,facet,x,r_per_trade,win_pct,constant';
const winRows=rows.map((row,i)=>{
  const cells=row.split(',');
  cells.splice(7,0,(50+i/10).toFixed(1));
  return cells.join(',');
});
const winCsv=[winHeader,...winRows].join('\n')+'\n';
const winSurface=core.buildSemanticSurface(winCsv,winDescriptor,{name:'win.surface.zip',size:456},{requiredMetrics:['r_per_trade']});
assert.equal(winSurface.metrics.win_pct.length,16,'declared win_pct passthrough must be loaded for the HUD');
assert.ok(Array.from(winSurface.metrics.win_pct).every(Number.isFinite),'win_pct passthrough values must remain numeric');
assert.deepEqual(winSurface.semanticDescriptor.results.metrics,['r_per_trade'],'passthrough promotion must not mutate canonical results.metrics');

const noWinDescriptor=JSON.parse(JSON.stringify(winDescriptor));
delete noWinDescriptor.results.passthrough_results;
const noWinSurface=core.buildSemanticSurface(winCsv,noWinDescriptor,{name:'old.surface.zip',size:456},{requiredMetrics:['r_per_trade']});
assert.equal(noWinSurface.metrics.win_pct,undefined,'undeclared win_pct must remain ignored so older packages still load normally');

const rootWinDescriptor=JSON.parse(JSON.stringify(noWinDescriptor));
rootWinDescriptor.passthrough_results=['win_pct'];
const rootWinSurface=core.buildSemanticSurface(winCsv,rootWinDescriptor,{name:'root-win.surface.zip',size:456},{requiredMetrics:['r_per_trade']});
assert.equal(rootWinSurface.metrics.win_pct.length,16,'root-level passthrough_results compatibility must expose win_pct');

console.log('PASS  Surface Package core preserves descriptor, passthrough Win %, blank-value, activation, and rectangle rules');
