'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

(async()=>{
  const bridge=fs.readFileSync(path.join(__dirname,'..','session-browser-bridge-v001.js'),'utf8');
  new vm.Script(bridge,{filename:'session-browser-bridge-v001.js'});

  const legacyStored={rows:1,cols:1,metrics:{m:Float64Array.from([1])},semanticDescriptor:{study_id:'volspike'}};
  let storedValue=legacyStored;
  const canvas={width:320,height:180};
  const calls={activate:0,reset:0,clearRect:0,clearStored:0,legacyClear:0};
  let sessionSerial=0;
  const ls=new Map();
  const context={
    console:{info(){},warn(){},error(){throw new Error('bridge console error: '+[...arguments].join(' '));}},
    setTimeout(fn){fn();return 1;},
    CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},
    dispatchEvent(){},
    document:{getElementById(){return null;}},
    localStorage:{getItem:k=>ls.has(k)?ls.get(k):null,setItem:(k,v)=>ls.set(k,String(v))},
    meta:{m:{invert:false}},
    values:Float64Array.from([1,2,3]),
    currentStats:{legacy:true},
    activeSurface:null,
    cache:new Map([['legacy',Float64Array.from([1])]]),
    statsCache:new Map([['legacy',{legacy:true}]]),
    canvas,
    ctx:{clearRect(){calls.clearRect++;}},
    loading:{style:{display:'none'},textContent:''},
    statusEl:{textContent:'legacy'},
    surfaceNameEl:{textContent:'Default surface',title:'legacy'},
    hover:{innerHTML:'legacy hover'},
    idbGetActive:async()=>storedValue,
    idbSetActive:async value=>{storedValue=value;},
    idbClearActive:async()=>{calls.legacyClear++;storedValue=null;},
    activateSurface:async()=>{calls.activate++;},
    hardReset:async()=>{calls.reset++;},
    SurfacePackageV021:{},
    AxisLayerControlsV023:{},
    SurfaceAutoFormatV026:{},
    SurfaceFilterV029:{activeFilters(){return false;},getFilterSpec(){return {}; }},
    SurfaceSemanticAnalysisV030:{buildTopology(){},computeSR(){},computeFR(){}},
    SurfaceScanEngineV035:{evaluateScan(){},analyzeRegionalRobustness(){},midrankPercentile(){}},
    SurfaceFilterCoreV001:{applySurfaceFilter(surface){return surface;}},
    SurfaceAnalyzerSessionV001:{
      createSession(){
        const id=++sessionSerial;
        return {
          async loadSurface(){throw new Error('inherited legacy surface should not load');},
          async clearStoredSurface(){calls.clearStored++;storedValue=null;},
          getState(){return {id,source:{loaded:false},researchDomain:{filtered:false,filterSpec:null}};},
          getAnalysisSnapshot(){return {id};}
        };
      }
    }
  };
  context.window=context;
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(bridge,context,{filename:'session-browser-bridge-v001.js'});
  await new Promise(resolve=>setImmediate(resolve));

  assert.equal(calls.legacyClear,1,'first v1 load must clear inherited legacy active surface once');
  assert.equal(storedValue,null);
  assert.equal(calls.activate,0,'blank startup must not activate the legacy default');
  assert.equal(context.values,null);
  assert.equal(context.currentStats,null);
  assert.equal(context.cache.size,0);
  assert.equal(context.statsCache.size,0);
  assert.equal(context.loading.style.display,'flex');
  assert.equal(context.loading.textContent,'Load a surface package to begin');
  assert.equal(context.statusEl.textContent,'No surface loaded');
  assert.equal(context.surfaceNameEl.textContent,'No surface loaded');
  assert.equal(context.hover.innerHTML,'');
  assert.ok(calls.clearRect>=1);
  assert.equal(ls.get('surface-analyzer-refactor-v1:legacy-storage-cleared'),'1');

  context.values=Float64Array.from([9]);
  context.currentStats={legacy:true};
  context.cache.set('legacy',1);
  context.statsCache.set('legacy',1);
  await context.hardReset();
  assert.equal(calls.clearStored,1);
  assert.equal(calls.reset,1);
  assert.equal(context.values,null);
  assert.equal(context.currentStats,null);
  assert.equal(context.cache.size,0);
  assert.equal(context.statsCache.size,0);
  assert.equal(context.statusEl.textContent,'No surface loaded');

  console.log('PASS  v1 clears inherited VolSpike storage once and keeps blank startup/reset state');
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
