'use strict';

const assert=require('node:assert/strict');
const core=require('../surface-package-core-v001.js');
const bridge=require('../session-package-bridge-v001.js');

const descriptor={
  descriptor_schema_version:1,
  study_id:'streaming-package-test',
  parameters:[
    {id:'p',type:'integer',source:'outer',topology_role:'ordered',values:[1,2],active_when:'always'},
    {id:'q',type:'enum',source:'inner',topology_role:'facet',values:[0,1],active_when:'always'}
  ],
  layout:{x_parameter_order:['q'],y_parameter_order:['p'],virtual_slots:[]},
  results:{metrics:['r_per_trade'],support_fields:[{id:'trades',type:'integer',role:'trade_count'}]},
  provenance:{source_row_count:4}
};

const csv=[
  'analysis_key,p,q,r_per_trade,trades,ignored_blob',
  '"k,3 ""quoted""",2,1,21.5,14,"ignored,\nblob ""x"""',
  'k1,1,0,10.25,11,unused-1',
  '"k,2",2,0,20.75,13,"unused,2"',
  'k0,1,1,11.5,12,unused-0'
].join('\r\n')+'\r\n';

function* chunkText(text,size){
  for(let i=0;i<text.length;i+=size)yield text.slice(i,i+size);
}

function comparable(surface){
  return {
    rows:surface.rows,
    cols:surface.cols,
    metrics:Object.fromEntries(Object.entries(surface.metrics).map(([k,v])=>[k,Array.from(v)])),
    supportFields:Object.fromEntries(Object.entries(surface.supportFields).map(([k,v])=>[k,Array.from(v)])),
    semanticParameterIndices:Object.fromEntries(Object.entries(surface.semanticParameterIndices).map(([k,v])=>[k,Array.from(v)])),
    semanticAxis:surface.semanticAxis,
    physicalIndexByVisual:Array.from(surface.physicalIndexByVisual)
  };
}

const reference=core.buildSemanticSurface(csv,descriptor,{name:'fixture.surface.zip',size:123},{requiredMetrics:['r_per_trade']});
for(const size of [1,2,3,7,16,64]){
  const streamed=core.buildSemanticSurfaceFromTextChunks(chunkText(csv,size),descriptor,{name:'fixture.surface.zip',size:123},{requiredMetrics:['r_per_trade']});
  assert.deepEqual(comparable(streamed),comparable(reference),`streaming parity failed for text chunk size ${size}`);
}

assert.throws(
  ()=>core.buildSemanticSurfaceFromTextChunks(chunkText('analysis_key,p,q,r_per_trade,trades\n"unterminated,1,0,1,1',2),{...descriptor,provenance:{source_row_count:1}},{},{requiredMetrics:['r_per_trade']}),
  /ends inside a quoted field/
);

const unicode='analysis_key,p,q,r_per_trade,trades\n"k-é-🙂",1,0,1.25,9\n';
const encoded=new TextEncoder().encode(unicode);
for(const size of [1,2,3,5,11]){
  const decoded=Array.from(bridge.decodeUtf8Chunks(encoded,size)).join('');
  assert.equal(decoded,unicode,`UTF-8 streaming decode failed for byte chunk size ${size}`);
}

console.log('PASS  Semantic package streaming parser preserves exact surface semantics across CSV and UTF-8 chunk boundaries');
