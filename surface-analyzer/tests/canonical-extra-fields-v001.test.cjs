'use strict';

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Package=require('../surface-package-core-v001.js');
const Filter=require('../core/surface-filter-engine-v001.js');
const Session=require('../core/surface-analyzer-session-v001.js');
const Research=require('../core/research-api-v001.js');

const descriptor={
  descriptor_schema_version:1,
  study_id:'canonical-extra-fields-test',
  provenance:{source_row_count:4,source_sha256:'support-test'},
  parameters:[
    {id:'y',type:'enum',topology_role:'regime',source:'outer',values:[0,1],active_when:'always'},
    {id:'x',type:'integer',topology_role:'ordered',source:'inner',values:[10,20],active_when:'always'}
  ],
  layout:{x_parameter_order:['x'],y_parameter_order:['y']},
  results:{metrics:['r_per_trade','win_pct'],support_fields:['trades']}
};
const csv=[
  'analysis_key,y,x,r_per_trade,win_pct,trades',
  'a,0,10,0.1,40,100',
  'b,0,20,0.2,45,90',
  'c,1,10,0.3,50,80',
  'd,1,20,0.4,55,70'
].join('\\n');

(async()=>{
  const surface=Package.buildSemanticSurface(csv,descriptor,{name:'support.surface.zip',size:1},{requiredMetrics:['r_per_trade','win_pct']});
  assert.deepEqual(Object.keys(surface.metrics),['r_per_trade','win_pct']);
  assert.deepEqual(Object.keys(surface.support),['trades']);
  assert.deepEqual(Array.from(surface.metrics.win_pct),[40,45,50,55]);
  assert.deepEqual(Array.from(surface.support.trades),[100,90,80,70]);
  Session.validateSurface(surface);

  const filtered=Filter.applySurfaceFilter(surface,{y:[1]});
  assert.equal(filtered.rows,1);
  assert.deepEqual(Array.from(filtered.metrics.win_pct),[50,55]);
  assert.deepEqual(Array.from(filtered.support.trades),[80,70]);
  Session.validateSurface(filtered);

  const research=Research.createResearchApi({
    createSession:Session.createSession,
    resolveSurface:async id=>id==='s'?surface:null,
    sessionOptions:{filterEngine:Filter}
  });
  const described=await research.execute({operation:'describe_surface',surface_id:'s'});
  assert.deepEqual(described.metrics,['r_per_trade','win_pct']);
  assert.deepEqual(described.support_fields,['trades']);

  assert.throws(()=>Package.validateDescriptor({...descriptor,results:{metrics:['r_per_trade'],support_fields:['r_per_trade']}}),/Duplicate descriptor result id/);

  const metadata=JSON.parse(fs.readFileSync(path.join(__dirname,'..','metrics.json'),'utf8'));
  assert.equal(metadata.win_pct.label,'Win %');
  assert.equal(metadata.win_pct.invert,false);
  assert.equal(metadata.win_pct.decimals,1);
  assert.equal(metadata.trades,undefined,'trades must remain off the main HUD metadata');

  const semantic=require('../semantic-analysis-v030.js');
  assert.equal(semantic.DRIVER_METRICS.includes('win_pct'),false,'win_pct SR/FR eligibility is intentionally undecided');
  assert.equal(semantic.DRIVER_METRICS.includes('trades'),false);

  console.log('PASS  canonical win_pct metric and trades support field stay separated across parse/filter/API/HUD contracts');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
