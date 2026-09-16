'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

(async()=>{
  const bridge=fs.readFileSync(path.join(__dirname,'..','session-browser-bridge-v001.js'),'utf8');
  new vm.Script(bridge,{filename:'session-browser-bridge-v001.js'});

  const stored={rows:1,cols:2,metrics:{m:Float64Array.from([1,2])},semanticDescriptor:{study_id:'test'}};
  const filtered={...stored,cols:1,metrics:{m:Float64Array.from([2])},surfaceFilter:{active:true}};
  const filterSpec={x:[1]};
  const calls={get:0,set:0,clear:0,load:[],activate:[],reset:0,setFilter:[],clearFilter:0,coreApply:0};
  let sessionSerial=0,filterActive=false;

  const context={
    console:{info(){},error(){throw new Error('bridge console error: '+[...arguments].join(' '));}},
    setTimeout(fn){fn();return 1;},
    CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},
    dispatchEvent(){},
    document:{getElementById(){return null;}},
    meta:{m:{invert:false}},
    idbGetActive:async()=>{calls.get++;return stored;},
    idbSetActive:async value=>{calls.set++;calls.lastSet=value;},
    idbClearActive:async()=>{calls.clear++;},
    activateSurface:async(surface,opt)=>{calls.activate.push({surface,opt});return 'ui-ok';},
    hardReset:async()=>{calls.reset++;},
    SurfacePackageV021:{},
    AxisLayerControlsV023:{},
    SurfaceAutoFormatV026:{},
    SurfaceFilterV029:{
      activeFilters(){return filterActive;},
      getFilterSpec(){return filterSpec;}
    },
    SurfaceSemanticAnalysisV030:{buildTopology(){},computeSR(){},computeFR(){}},
    SurfaceScanEngineV035:{evaluateScan(){},analyzeRegionalRobustness(){},midrankPercentile(){}},
    SurfaceFilterCoreV001:{
      applySurfaceFilter(source,spec){calls.coreApply++;assert.equal(source,stored);assert.equal(spec,filterSpec);return filtered;}
    },
    SurfaceAnalyzerSessionV001:{
      createSession(opts){
        const id=++sessionSerial;
        let sourceSurface=null,researchSurface=null,currentFilter=null;
        return {
          id,
          async loadSurface(surface,opt){calls.load.push({id,surface,opt});sourceSurface=surface;researchSurface=surface;currentFilter=null;if(opt.persist)await opts.storageAdapter.set('active-surface',surface);},
          async setFilter(spec){calls.setFilter.push(spec);researchSurface=await opts.filterAdapter.apply(sourceSurface,spec);currentFilter=spec;},
          clearFilter(){calls.clearFilter++;researchSurface=sourceSurface;currentFilter=null;},
          async clearStoredSurface(){await opts.storageAdapter.remove('active-surface');},
          getState(){return {id,source:{loaded:!!sourceSurface},researchDomain:{filtered:!!sourceSurface&&researchSurface!==sourceSurface,filterSpec:currentFilter}};},
          getAnalysisSnapshot(){return {id,sourceSurface,researchSurface};}
        };
      }
    }
  };
  context.window=context;
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(bridge,context,{filename:'session-browser-bridge-v001.js'});
  await new Promise(resolve=>setImmediate(resolve));

  assert.ok(context.SurfaceAnalyzerBrowserSessionV001);
  assert.equal(calls.get,1);
  assert.equal(calls.load.length,1);
  assert.equal(calls.load[0].surface,stored);
  assert.equal(calls.load[0].opt.persist,false);
  assert.equal(calls.activate.length,1);
  assert.equal(calls.activate[0].opt.persist,false);
  assert.equal(await context.idbGetActive(),null);

  filterActive=true;
  await context.activateSurface(stored,{persist:false});
  assert.equal(calls.load.length,1,'filter refresh must not become a new source load');
  assert.equal(calls.setFilter.length,1,'session.setFilter owns filter application');
  assert.equal(calls.setFilter[0],filterSpec);
  assert.equal(calls.coreApply,1,'session filter adapter must invoke the canonical core exactly once');
  assert.equal(context.SurfaceAnalyzerBrowserSessionV001.getState().researchDomain.filtered,true);

  filterActive=false;
  await context.activateSurface(stored,{persist:false});
  assert.equal(calls.load.length,1,'filter reset must preserve canonical source identity');
  assert.equal(calls.clearFilter,1);
  assert.equal(context.SurfaceAnalyzerBrowserSessionV001.getState().researchDomain.filtered,false);

  const next={rows:1,cols:1,metrics:{m:Float64Array.from([3])},semanticDescriptor:{study_id:'next'}};
  await context.activateSurface(next,{persist:true});
  assert.equal(calls.load.length,2);
  assert.equal(calls.load[1].surface,next);
  assert.equal(calls.set,1);
  assert.equal(calls.activate.at(-1).opt.persist,false);

  await context.hardReset();
  assert.equal(calls.clear,1);
  assert.equal(calls.reset,1);
  assert.equal(context.SurfaceAnalyzerBrowserSessionV001.getState().id,2);

  console.log('PASS  v1 bridge routes filter state through session.setFilter and canonical core');
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
