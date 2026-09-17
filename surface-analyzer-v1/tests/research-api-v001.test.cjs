'use strict';
const assert=require('node:assert/strict');
const semantic=require('../semantic-analysis-v030.js');
const scanEngine=require('../scan-layer-v033.js');
const Session=require('../core/surface-analyzer-session-v001.js');
const filterEngine=require('../core/surface-filter-engine-v001.js');
const Research=require('../core/research-api-v001.js');

function fixture(){
  return {
    fileName:'api-fixture.surface.zip',fileSize:1,rows:2,cols:3,
    metrics:{r_per_trade:Float64Array.from([0,.5,1,.2,.7,1.2]),max_drawdown_r:Float64Array.from([6,5,4,7,6,5])},
    semanticDescriptor:{
      descriptor_schema_version:1,descriptor_version:'api-v1',study_id:'api-fixture',
      provenance:{source_sha256:'api-sha'},results:{metrics:['r_per_trade','max_drawdown_r']},
      parameters:[
        {id:'x',label:'Length',topology_role:'ordered',source:'outer',values:[10,11,12],active_when:'always'},
        {id:'f',label:'Family',topology_role:'facet',source:'inner',values:['A','B'],active_when:'always'}
      ],
      layout:{x_parameter_order:['x'],y_parameter_order:['f']}
    },
    semanticAxis:{x:[{x:10},{x:11},{x:12}],y:[{f:'A'},{f:'B'}]},
    semanticParameterIndices:{x:Int16Array.from([0,1,2,0,1,2]),f:Int16Array.from([0,0,0,1,1,1])}
  };
}

(async()=>{
  const surface=fixture();
  const api=Research.createResearchApi({
    createSession:Session.createSession,
    resolveSurface:async id=>id==='fixture'?surface:null,
    listSurfaces:async()=>[{surface_id:'fixture',study_id:'api-fixture'}],
    sessionOptions:{semanticEngine:semantic,scanEngine,filterEngine,metricMetadata:{r_per_trade:{invert:false},max_drawdown_r:{invert:true}}}
  });

  const listed=await api.execute({operation:'list_surfaces'});
  assert.deepEqual(listed.surfaces,[{surface_id:'fixture',study_id:'api-fixture'}]);

  const described=await api.execute({operation:'describe_surface',surface_id:'fixture'});
  assert.equal(described.configurations,6);
  assert.deepEqual(described.metrics,['r_per_trade','max_drawdown_r']);
  assert.deepEqual(described.parameters.map(p=>p.values),[[10,11,12],['A','B']]);

  const result=await api.execute({
    operation:'analyze_surface',surface_id:'fixture',domain:{x:[11,12]},
    structural_robustness:['r_per_trade'],facet_replication:['r_per_trade'],
    scan:{criteria:[{id:'p',enabled:true,source:'performance',metric:'r_per_trade',basis:'raw',operator:'>=',value:.5}],region_rules:{min_cells:1}},
    regional_robustness:true
  });
  assert.equal(result.research_domain.rows,2);
  assert.equal(result.research_domain.cols,2);
  assert.equal(result.research_domain.configurations,4);
  assert.equal(result.analyses.structural_robustness.r_per_trade.count,4);
  assert.equal(result.analyses.facet_replication.r_per_trade.count,4);
  assert.equal(result.scan.total_cells,4);
  assert.ok(result.scan.regional_robustness);
  assert.equal('mask' in result.scan,false,'compact API must not expose scan masks by default');
  assert.equal('regionId' in result.scan,false,'compact API must not expose scan region arrays by default');
  assert.equal('mask' in result.scan.regional_robustness,false,'compact API must not expose RR masks by default');

  assert.throws(()=>Research.domainToFilterSpec(surface,{x:[99]}),/undeclared domain value/);
  await assert.rejects(()=>api.execute({operation:'analyze_surface',surface_id:'fixture',regional_robustness:true}),/requires scan criteria/);
  await assert.rejects(()=>api.execute({operation:'analyze_surface',surface_id:'missing'}),/Unknown surface_id/);

  console.log('PASS  research API is stateless, value-addressed, compact, and session-backed');
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
