'use strict';

const assert=require('node:assert/strict');
const filter=require('../surface-filter-core-v001.js');
const semantic=require('../semantic-analysis-v030.js');

function rectangleSurface(){
  const descriptor={
    study_id:'filter-test',
    parameters:[
      {id:'y',topology_role:'regime',source:'outer',values:[0,1],active_when:'always'},
      {id:'x',topology_role:'ordered',source:'inner',values:[0,1,2,3],active_when:'always'}
    ],
    layout:{x_parameter_order:['x'],y_parameter_order:['y']}
  };
  const xAxis=[0,1,2,3].map(x=>({x})),yAxis=[0,1].map(y=>({y}));
  const x=[],y=[],m=[];
  for(let r=0;r<2;r++)for(let c=0;c<4;c++){x.push(c);y.push(r);m.push(r*10+c);}
  return {rows:2,cols:4,semanticDescriptor:descriptor,semanticAxis:{x:xAxis,y:yAxis},semanticParameterIndices:{x:Int16Array.from(x),y:Int16Array.from(y)},metrics:{m:Float64Array.from(m)}};
}

function facetSurface(){
  const descriptor={
    study_id:'filter-facet-test',
    parameters:[
      {id:'reg',topology_role:'regime',source:'outer',values:[0],active_when:'always'},
      {id:'f',topology_role:'facet',source:'inner',values:[0,1],active_when:'always'},
      {id:'x',topology_role:'ordered',source:'inner',values:[0,1,2,3],active_when:'always'}
    ],
    layout:{x_parameter_order:['f','x'],y_parameter_order:['reg']}
  };
  const xAxis=[],f=[],x=[],reg=[],m=[];
  for(const fv of [0,1])for(const xv of [0,1,2,3]){xAxis.push({f:fv,x:xv});f.push(fv);x.push(xv);reg.push(0);m.push(xv+fv*.1);}
  return {rows:1,cols:8,semanticDescriptor:descriptor,semanticAxis:{x:xAxis,y:[{reg:0}]},semanticParameterIndices:{reg:Int16Array.from(reg),f:Int16Array.from(f),x:Int16Array.from(x)},metrics:{m:Float64Array.from(m)}};
}

const src=rectangleSurface();
assert.equal(filter.applySurfaceFilter(src,{}),src);
assert.equal(filter.applySurfaceFilter(src,{x:[0,1,2,3]}),src);
const fx=filter.applySurfaceFilter(src,{x:[0,2,3]});
assert.equal(fx.rows,2);assert.equal(fx.cols,3);
assert.deepEqual(Array.from(fx.metrics.m),[0,2,3,10,12,13]);
assert.deepEqual(Array.from(fx.semanticParameterIndices.x),[0,2,3,0,2,3]);
assert.deepEqual(fx.semanticAxis.x,[{x:0},{x:2},{x:3}]);
assert.deepEqual(fx.surfaceFilter,{active:true,sourceConfigs:8,visibleConfigs:6});
const gapGraph=semantic.buildTopology(fx);
assert.equal(gapGraph.hardSurfaceCount,2);
assert.equal(gapGraph.components,4,'removed x=1 must not bridge x=0 to x=2');
assert.equal(gapGraph.undirectedEdgeCount,2,'only x=2↔3 remains in each hard surface');

const fy=filter.applySurfaceFilter(src,{y:[1]});
assert.equal(fy.rows,1);assert.equal(fy.cols,4);assert.deepEqual(Array.from(fy.metrics.m),[10,11,12,13]);
assert.deepEqual(filter.normalizeFilterSpec({x:new Set([3,1]),y:[1,0]}),{x:[1,3],y:[0,1]});
assert.throws(()=>filter.applySurfaceFilter(src,{x:[]}),/Filter removes every configuration/);

const facetSrc=facetSurface(),facetFiltered=filter.applySurfaceFilter(facetSrc,{f:[0]});
assert.equal(facetFiltered.cols,4);
const facetGraph=semantic.buildTopology(facetFiltered),fr=semantic.computeFR(facetFiltered.metrics.m,facetGraph).facet_replication;
assert.ok(Array.from(fr).every(Number.isNaN),'FR must stay blank when the filter fixes the only facet value');

console.log('PASS  Surface Filter core preserves domain, gap, and facet-exclusion invariants');
