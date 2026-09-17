(function(root,factory){
  const API=factory(root);
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(root)root.SurfaceAnalyzerSessionCoreCompatV001=API;
  if(typeof window!=='undefined')API.install();
})(typeof window!=='undefined'?window:globalThis,function(root){
  'use strict';

  const VERSION='surface-analyzer-session-core-compat-v001';
  const ACTIVE_KEY='active-surface';

  function clonePlain(value){return value==null?value:JSON.parse(JSON.stringify(value));}

  function wrapSession(coreApi,filterEngine,options={}){
    if(!coreApi?.createSession)throw new Error('Canonical Surface Analyzer core session is unavailable.');
    if(!filterEngine?.applySurfaceFilter)throw new Error('Canonical Surface Filter engine is unavailable.');
    const capturedPerformanceMasks=new WeakMap();
    const scanEngine=options.scanEngine;
    const scanAdapter=scanEngine?{
      ...scanEngine,
      async evaluateScan(...args){
        const result=await scanEngine.evaluateScan(...args);
        if(result?.performanceMask)capturedPerformanceMasks.set(result,result.performanceMask);
        return result;
      }
    }:scanEngine;
    const inner=coreApi.createSession({
      storageAdapter:options.storageAdapter||null,
      filterEngine,
      semanticEngine:options.semanticEngine,
      scanEngine:scanAdapter,
      metricMetadata:options.metricMetadata||{},
      activeKey:ACTIVE_KEY
    });

    function snapshot(){
      const state=inner.getState(),source=inner.getSourceSurface(),research=inner.getFilteredSurface();
      return {
        version:state.version,
        domainRevision:state.revision,
        sourceSurface:source,
        researchSurface:research,
        filterSpec:clonePlain(state.filterSpec),
        topology:inner.getTopology(),
        structuralRobustness:{},
        facetReplication:{},
        scanConfig:clonePlain(state.scanConfig),
        scanResult:inner.getScanResult(),
        regionalRobustness:inner.getRegionalRobustnessResult()
      };
    }

    function stateSummary(){
      const state=inner.getState(),source=inner.getSourceSurface(),research=inner.getFilteredSurface(),topology=inner.getTopology();
      return {
        version:state.version,
        loaded:state.hasSurface,
        domainRevision:state.revision,
        source:{
          loaded:state.hasSurface,
          rows:source?.rows??null,
          cols:source?.cols??null,
          studyId:source?.semanticDescriptor?.study_id??null
        },
        researchDomain:{
          rows:research?.rows??null,
          cols:research?.cols??null,
          filtered:!!research&&!!source&&research!==source,
          filterSpec:clonePlain(state.filterSpec)
        },
        topology:topology?{
          hardSurfaceCount:topology.hardSurfaceCount??null,
          components:topology.components??null,
          undirectedEdgeCount:topology.undirectedEdgeCount??null
        }:null,
        cachedStructuralRobustness:[...(state.structuralRobustnessMetrics||[])],
        cachedFacetReplication:[...(state.facetReplicationMetrics||[])],
        scan:{active:!!state.hasScanResult,config:clonePlain(state.scanConfig)},
        regionalRobustness:{active:!!state.hasRegionalRobustnessResult}
      };
    }

    async function runScan(config){
      const result=await inner.runScan(config);
      const performanceMask=capturedPerformanceMasks.get(result);
      if(performanceMask)result.performanceMask=performanceMask;
      return result;
    }

    function runRegionalRobustness(){
      const result=inner.getRegionalRobustnessResult();
      if(!result)throw new Error('Regional Robustness has not been computed for the current Scan result.');
      return result;
    }

    return {
      version:inner.version||coreApi.VERSION||VERSION,
      loadSurface:(surface,opt)=>inner.loadSurface(surface,opt),
      restoreSurface:()=>inner.restore(),
      clearStoredSurface:async()=>{
        if(options.storageAdapter?.remove)await options.storageAdapter.remove(ACTIVE_KEY);
      },
      setFilter:spec=>inner.setFilter(spec),
      clearFilter:()=>inner.clearFilter(),
      getPerformanceSeries:(metricId,opt)=>inner.getPerformanceSeries(metricId,opt),
      computeStructuralRobustness:metricId=>inner.computeStructuralRobustness(metricId),
      computeFacetReplication:metricId=>inner.computeFacetReplication(metricId),
      runScan,
      clearScan:()=>inner.clearScan(),
      runRegionalRobustness,
      getState:stateSummary,
      getAnalysisSnapshot:snapshot,
      subscribe:listener=>inner.subscribe(listener),
      getCanonicalSession:()=>inner
    };
  }

  function install(){
    if(root.__SurfaceAnalyzerSessionCoreV001)return root.SurfaceAnalyzerSessionV001;
    const coreApi=root.SurfaceAnalyzerSessionV001,filterEngine=root.SurfaceFilterEngineV001;
    if(!coreApi?.createSession||!filterEngine?.applySurfaceFilter)throw new Error('Canonical session/filter core must load before compatibility adapter.');
    root.__SurfaceAnalyzerSessionCoreV001=coreApi;
    root.SurfaceAnalyzerSessionV001={
      VERSION,
      createSession:options=>wrapSession(coreApi,filterEngine,options)
    };
    return root.SurfaceAnalyzerSessionV001;
  }

  return {VERSION,wrapSession,install};
});
