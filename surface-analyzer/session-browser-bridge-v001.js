(function(root){
  'use strict';
  if(typeof window==='undefined')return;

  const VERSION='session-browser-bridge-v001';
  const ACTIVE_KEY='active-surface';
  const realGet=typeof idbGetActive==='function'?idbGetActive:null;
  const realSet=typeof idbSetActive==='function'?idbSetActive:null;
  const realClear=typeof idbClearActive==='function'?idbClearActive:null;

  if(!realGet||!realSet||!realClear){
    console.error('Surface Analyzer v1 bridge: IndexedDB lifecycle functions are unavailable.');
    return;
  }

  idbGetActive=async()=>null;

  let installed=false;
  let session=null;
  let lastActivate=null;
  let stableTicks=0;
  let tries=0;

  const storageAdapter={
    get:async key=>key===ACTIVE_KEY?realGet():null,
    set:async(key,value)=>{if(key===ACTIVE_KEY)await realSet(value);},
    remove:async key=>{if(key===ACTIVE_KEY)await realClear();}
  };

  function dependenciesReady(){
    return typeof activateSurface==='function'&&
      typeof hardReset==='function'&&
      typeof meta!=='undefined'&&!!meta&&
      !!root.SurfacePackageV021&&
      !!root.AxisLayerControlsV023&&
      !!root.SurfaceAutoFormatV026&&
      !!root.SurfaceFilterV029&&
      !!root.SurfaceSemanticAnalysisV030&&
      !!root.SurfaceScanEngineV035&&
      !!root.SurfaceAnalyzerSessionV001&&
      !!root.SurfaceFilterCoreV001;
  }

  function createSession(){
    return root.SurfaceAnalyzerSessionV001.createSession({
      semanticEngine:root.SurfaceSemanticAnalysisV030,
      scanEngine:root.SurfaceScanEngineV035,
      metricMetadata:meta,
      filterAdapter:{apply:(surface,spec)=>root.SurfaceFilterCoreV001.applySurfaceFilter(surface,spec)},
      storageAdapter
    });
  }

  function publish(){
    root.SurfaceAnalyzerBrowserSessionV001={
      version:VERSION,
      getSession:()=>session,
      getState:()=>session?.getState?.()||null,
      getAnalysisSnapshot:()=>session?.getAnalysisSnapshot?.()||null
    };
  }

  function sourceLoaded(){return !!session?.getState?.()?.source?.loaded;}

  function closeFilterPopover(){
    if(typeof document==='undefined')return;
    document.getElementById('surfaceFilterControl')?.classList.remove('open');
  }

  function syncResearchDomainFromFilter(){
    if(!sourceLoaded())return;
    const api=root.SurfaceFilterV029;
    if(api?.activeFilters?.()){
      const source=session.getAnalysisSnapshot().sourceSurface;
      const filtered=api.filterSurface(source);
      session.applyFilteredSurface(filtered,null);
    }else if(session.getState()?.researchDomain?.filtered){
      session.clearFilter();
    }
  }

  async function install(){
    const baseActivate=activateSurface;
    const baseHardReset=hardReset;
    session=createSession();

    async function activateThroughSession(surface,opt={},sourceLoad=false){
      const persist=opt?.persist!==false;
      if(sourceLoad||persist||!sourceLoaded())await session.loadSurface(surface,{persist});
      const out=await baseActivate(surface,{...opt,persist:false});
      syncResearchDomainFromFilter();
      closeFilterPopover();
      return out;
    }

    activateSurface=async function(surface,opt={}){
      return activateThroughSession(surface,opt,false);
    };

    hardReset=async function(){
      await session.clearStoredSurface();
      session=createSession();
      publish();
      const out=await baseHardReset();
      closeFilterPopover();
      return out;
    };

    publish();

    const restored=await realGet();
    if(restored)await activateThroughSession(restored,{persist:false},true);

    root.dispatchEvent(new CustomEvent('surface-analyzer-session-ready',{
      detail:{version:VERSION,restored:!!restored}
    }));
    console.info(`Surface Analyzer v1 session bridge active${restored?' · restored saved surface':''}`);
  }

  function probe(){
    if(installed)return;
    if(!dependenciesReady()){
      if(tries++<600)setTimeout(probe,25);
      else console.error('Surface Analyzer v1 bridge: dependencies did not become ready.');
      return;
    }

    if(activateSurface!==lastActivate){
      lastActivate=activateSurface;
      stableTicks=0;
      setTimeout(probe,25);
      return;
    }
    if(++stableTicks<4){setTimeout(probe,25);return;}

    installed=true;
    install().catch(err=>{
      installed=false;
      console.error('Surface Analyzer v1 bridge failed:',err);
      const el=typeof loading!=='undefined'?loading:null;
      if(el){el.style.display='flex';el.textContent='Session bridge failed: '+err.message;}
    });
  }

  probe();
})(typeof window!=='undefined'?window:globalThis);
