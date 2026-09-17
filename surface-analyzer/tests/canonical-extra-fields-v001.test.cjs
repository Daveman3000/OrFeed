'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Package=require('../surface-package-core-v001.js');
const Filter=require('../core/surface-filter-engine-v001.js');
const LegacyFilter=require('../surface-filter-core-v001.js');
const Session=require('../core/surface-analyzer-session-v001.js');
const Research=require('../core/research-api-v001.js');
const Semantic=require('../semantic-analysis-v030.js');
const Scan=require('../scan-layer-v033.js');

const supportDecl={id:'trades',type:'integer',role:'sample_support'};
const descriptor={
  descriptor_schema_version:1,
  study_id:'canonical-extra-fields-test',
  provenance:{source_row_count:4,source_sha256:'support-test'},
  parameters:[
    {id:'y',type:'enum',topology_role:'regime',source:'outer',values:[0,1],active_when:'always'},
    {id:'x',type:'integer',topology_role:'ordered',source:'inner',values:[10,20],active_when:'always'}
  ],
  layout:{x_parameter_order:['x'],y_parameter_order:['y']},
  results:{metrics:['r_per_trade','win_pct'],support_fields:[supportDecl]}
};
const csv=[
  'analysis_key,y,x,r_per_trade,win_pct,trades',
  'a,0,10,0.1,40,100',
  'b,0,20,0.2,45,90',
  'c,1,10,0.3,50,80',
  'd,1,20,0.4,55,70'
].join('\n');

function build(text=csv,d=descriptor){
  return Package.buildSemanticSurface(text,d,{name:'support.surface.zip',size:1},{requiredMetrics:['r_per_trade','win_pct']});
}

(async()=>{
  const surface=build();
  assert.deepEqual(Object.keys(surface.metrics),['r_per_trade','win_pct']);
  assert.deepEqual(Object.keys(surface.supportFields),['trades']);
  assert.ok(surface.supportFields.trades instanceof Int32Array);
  assert.deepEqual(Array.from(surface.metrics.win_pct),[40,45,50,55]);
  assert.deepEqual(Array.from(surface.supportFields.trades),[100,90,80,70]);
  Session.validateSurface(surface);

  const filtered=Filter.applySurfaceFilter(surface,{y:[1]});
  assert.equal(filtered.rows,1);
  assert.ok(filtered.supportFields.trades instanceof Int32Array);
  assert.deepEqual(Array.from(filtered.metrics.win_pct),[50,55]);
  assert.deepEqual(Array.from(filtered.supportFields.trades),[80,70]);
  Session.validateSurface(filtered);

  const legacyFiltered=LegacyFilter.applySurfaceFilter(surface,{y:new Set([1]),x:new Set([0,1])});
  assert.ok(legacyFiltered.supportFields.trades instanceof Int32Array);
  assert.deepEqual(Array.from(legacyFiltered.supportFields.trades),[80,70]);

  const research=Research.createResearchApi({
    createSession:Session.createSession,
    resolveSurface:async id=>id==='s'?surface:null,
    sessionOptions:{filterEngine:Filter,semanticEngine:Semantic,scanEngine:Scan}
  });
  const described=await research.execute({operation:'describe_surface',surface_id:'s'});
  assert.deepEqual(described.metrics,['r_per_trade','win_pct']);
  assert.deepEqual(described.support_fields,[supportDecl]);

  // Support fields are not metrics and therefore cannot drive Performance, SR, FR or Scan.
  const direct=Session.createSession({filterEngine:Filter,semanticEngine:Semantic,scanEngine:Scan});
  await direct.loadSurface(surface);
  assert.throws(()=>direct.getPerformanceSeries('trades'),/does not contain trades/);
  assert.throws(()=>direct.computeStructuralRobustness('trades'),/does not contain trades/);
  assert.throws(()=>direct.computeFacetReplication('trades'),/does not contain trades/);
  await assert.rejects(()=>direct.runScan({
    criteria:[{id:'bad',enabled:true,source:'performance',metric:'trades',basis:'raw',operator:'>=',value:1}],
    region_rules:{min_cells:1}
  }),/does not contain trades/);

  // Typed descriptor validation is strict and fail-closed.
  assert.throws(()=>Package.validateDescriptor({...descriptor,results:{metrics:['r_per_trade'],support_fields:['trades']}}),/typed objects/);
  assert.throws(()=>Package.validateDescriptor({...descriptor,results:{metrics:['r_per_trade'],support_fields:[{id:'trades',type:'number',role:'sample_support'}]}}),/unsupported support field type/);
  assert.throws(()=>Package.validateDescriptor({...descriptor,results:{metrics:['r_per_trade'],support_fields:[{id:'r_per_trade',type:'integer',role:'sample_support'}]}}),/Duplicate descriptor result id/);
  assert.throws(()=>build(csv.replace('100','100.5')),/must be an integer/);
  assert.throws(()=>build(csv.replace('100','2147483648')),/outside Int32 range/);

  // Older descriptors with no support_fields remain valid/loadable.
  const oldDescriptor={...descriptor,results:{metrics:['r_per_trade','win_pct']}};
  const oldCsv=csv.split('\n').map((line,i)=>i===0?line.replace(',trades',''):line.replace(/,[^,]+$/,'')).join('\n');
  const oldSurface=build(oldCsv,oldDescriptor);
  assert.deepEqual(Object.keys(oldSurface.supportFields),[]);
  Session.validateSurface(oldSurface);

  const metadata=JSON.parse(fs.readFileSync(path.join(__dirname,'..','metrics.json'),'utf8'));
  assert.equal(metadata.win_pct.label,'Win %');
  assert.equal(metadata.trades,undefined,'trades must remain off the main HUD metadata');
  assert.equal(Semantic.DRIVER_METRICS.includes('win_pct'),false,'win_pct SR/FR eligibility remains intentionally undecided');
  assert.equal(Semantic.DRIVER_METRICS.includes('trades'),false);

  console.log('PASS  typed support fields remain separate from metrics across parse/filter/session/API/analysis contracts');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
