'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

(async()=>{
  const bridge=fs.readFileSync(path.join(__dirname,'..','session-browser-bridge-v001.js'),'utf8');
  new vm.Script(bridge,{filename:'session-browser-bridge-v001.js'});

  const stored={rows:1,cols:1,metrics:{m:Float64Array.from([1])},semanticDescriptor:{study_id:'test'}};
  const calls={get:0,set:0,clear:0,load:[],activate:[],reset:0};
  let sessionSerial=0;

  const context={
    console:{info(){},error(){throw new Error('bridge console error: '+[...arguments].join(' '));}},
    setTimeout(fn){fn();return 1;},
    CustomEvent:function(type,init){this.type=type;this.detail=init?.detail;},
    dispatchEvent(){},
    meta:{m:{invert:false}},
    idbGetActive:async()=>{calls.get++;return stored;},
    idbSetActive:async value=>{calls.set++;calls.lastSet=value;},
    idbClearActive:async()=>{calls.clear++;},
    activateSurface:async(surface,opt)=>{calls.activate.push({surface,opt});return 'ui-ok';},
    hardReset:async()=>{calls.reset++;},
    SurfacePackageV021:{},
    AxisLayerControlsV023:{},
    SurfaceAutoFormatV026:{},
    SurfaceFilterV029:{},
    SurfaceSemanticAnalysisV030:{buildTopology(){},computeSR(){},computeFR(){}},
    SurfaceScanEngineV035:{evaluateScan(){},analyzeRegionalRobustness(){},midrankPercentile(){}},
    SurfaceFilterCoreV001:{applySurfaceFilter:s=>s},
    SurfaceAnalyzerSessionV001:{
      createSession(opts){
        const id=++sessionSerial;
        return {
          id,
          async loadSurface(surface,opt){calls.load.push({id,surface,opt});if(opt.persist)await opts.storageAdapter.set('active-surface',surface);},
          async clearStoredSurface(){await opts.storageAdapter.remove('active-surface');},
          getState(){return {id};},
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

  assert.ok(context.SurfaceAnalyzerBrowserSessionV001,'bridge API should publish');
  assert.equal(calls.get,1,'bridge should read saved surface exactly once');
  assert.equal(calls.load.length,1,'saved surface should enter canonical session once');
  assert.equal(calls.load[0].surface,stored);
  assert.equal(calls.load[0].opt.persist,false);
  assert.equal(calls.activate.length,1,'UI activation should happen once after session restore');
  assert.equal(calls.activate[0].surface,stored);
  assert.equal(calls.activate[0].opt.persist,false);
  assert.equal(await context.idbGetActive(),null,'legacy restore hooks must remain gated');

  const next={rows:1,cols:1,metrics:{m:Float64Array.from([2])},semanticDescriptor:{study_id:'next'}};
  await context.activateSurface(next,{persist:true});
  assert.equal(calls.load.length,2);
  assert.equal(calls.set,1,'session owns persistence for new loads');
  assert.equal(calls.activate.length,2);
  assert.equal(calls.activate[1].opt.persist,false,'legacy UI must not persist a second time');

  await context.hardReset();
  assert.equal(calls.clear,1,'session clears stored surface');
  assert.equal(calls.reset,1,'legacy UI reset still runs');
  assert.equal(context.SurfaceAnalyzerBrowserSessionV001.getState().id,2,'hard reset replaces session state');

  console.log('PASS  v1 browser bridge owns load/restore persistence without duplicate UI writes');
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
