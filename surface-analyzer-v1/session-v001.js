(function(root,factory){
  const API=factory();
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
  if(root)root.SurfaceAnalyzerSessionV001=API;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const VERSION='surface-analyzer-session-v001';

  function assertSurface(surface){
    if(!surface||!Number.isInteger(surface.rows)||!Number.isInteger(surface.cols)||surface.rows<=0||surface.cols<=0)throw new Error('A loaded surface must declare positive integer rows and cols.');
    if(!surface.metrics||typeof surface.metrics!=='object')throw new Error('A loaded surface must contain metrics.');
    return surface;
  }

  function clonePlain(value){
    if(value==null)return value;
    return JSON.parse(JSON.stringify(value));
  }

  class SurfaceAnalyzerSession{
    constructor({semanticEngine,scanEngine,metricMetadata={},filterAdapter=null,storageAdapter=null}={}){
      if(!semanticEngine?.buildTopology||!semanticEngine?.computeSR||!semanticEngine?.computeFR)throw new Error('semanticEngine must provide buildTopology, computeSR, and computeFR.');
      if(!scanEngine?.evaluateScan||!scanEngine?.analyzeRegionalRobustness||!scanEngine?.midrankPercentile)throw new Error('scanEngine must provide evaluateScan, analyzeRegionalRobustness, and midrankPercentile.');
      this.semanticEngine=semanticEngine;
      this.scanEngine=scanEngine;
      this.metricMetadata=metricMetadata||{};
      this.filterAdapter=filterAdapter;
      this.storageAdapter=storageAdapter;
      this.listeners=new Set();
      this.sourceSurface=null;
      this.researchSurface=null;
      this.filterSpec=null;
      this.domainRevision=0;
      this.topology=null;
      this.srCache=new Map();
      this.frCache=new Map();
      this.scanConfig=null;
      this.scanResult=null;
      this.regionalRobustness=null;
    }

    subscribe(listener){
      if(typeof listener!=='function')throw new Error('Session listener must be a function.');
      this.listeners.add(listener);
      return ()=>this.listeners.delete(listener);
    }

    _emit(type,detail={}){
      const event={type,version:VERSION,domainRevision:this.domainRevision,...detail};
      for(const listener of this.listeners){try{listener(event,this);}catch(error){setTimeout(()=>{throw error;},0);}}
    }

    _invalidateDomain(reason){
      this.domainRevision++;
      this.topology=null;
      this.srCache.clear();
      this.frCache.clear();
      this.scanConfig=null;
      this.scanResult=null;
      this.regionalRobustness=null;
      this._emit('domainChanged',{reason});
    }

    _invalidateScan(reason){
      this.scanResult=null;
      this.regionalRobustness=null;
      this._emit('scanInvalidated',{reason});
    }

    async loadSurface(surface,{persist=false}={}){
      assertSurface(surface);
      this.sourceSurface=surface;
      this.researchSurface=surface;
      this.filterSpec=null;
      this._invalidateDomain('surfaceLoaded');
      if(persist&&this.storageAdapter?.set)await this.storageAdapter.set('active-surface',surface);
      this._emit('surfaceLoaded');
      return this.getState();
    }

    async restoreSurface(){
      if(!this.storageAdapter?.get)throw new Error('No storage adapter is configured.');
      const surface=await this.storageAdapter.get('active-surface');
      if(!surface)return null;
      return this.loadSurface(surface,{persist:false});
    }

    async clearStoredSurface(){
      if(this.storageAdapter?.remove)await this.storageAdapter.remove('active-surface');
    }

    async setFilter(filterSpec){
      if(!this.sourceSurface)throw new Error('No surface is loaded.');
      if(!this.filterAdapter?.apply)throw new Error('No filter adapter is configured.');
      const filtered=await this.filterAdapter.apply(this.sourceSurface,filterSpec);
      assertSurface(filtered);
      this.researchSurface=filtered;
      this.filterSpec=clonePlain(filterSpec);
      this._invalidateDomain('filterChanged');
      return this.getState();
    }

    applyFilteredSurface(filteredSurface,filterSpec=null){
      if(!this.sourceSurface)throw new Error('No surface is loaded.');
      assertSurface(filteredSurface);
      this.researchSurface=filteredSurface;
      this.filterSpec=clonePlain(filterSpec);
      this._invalidateDomain('filteredSurfaceApplied');
      return this.getState();
    }

    clearFilter(){
      if(!this.sourceSurface)return this.getState();
      this.researchSurface=this.sourceSurface;
      this.filterSpec=null;
      this._invalidateDomain('filterCleared');
      return this.getState();
    }

    _metricInvert(metricId){return !!this.metricMetadata?.[metricId]?.invert;}

    _requireResearchSurface(){
      if(!this.researchSurface)throw new Error('No surface is loaded.');
      return this.researchSurface;
    }

    _ensureTopology(){
      const surface=this._requireResearchSurface();
      if(!this.topology)this.topology=this.semanticEngine.buildTopology(surface);
      return this.topology;
    }

    getPerformanceSeries(metricId,{basis='raw'}={}){
      const surface=this._requireResearchSurface(),raw=surface.metrics?.[metricId];
      if(!raw)throw new Error(`Surface does not contain ${metricId}`);
      if(basis==='raw')return raw;
      if(basis==='percentile')return this.scanEngine.midrankPercentile(raw,this._metricInvert(metricId));
      throw new Error(`Unsupported performance basis ${basis}`);
    }

    computeStructuralRobustness(metricId){
      if(this.srCache.has(metricId))return this.srCache.get(metricId);
      const raw=this.getPerformanceSeries(metricId,{basis:'raw'}),result=this.semanticEngine.computeSR(raw,this._ensureTopology());
      this.srCache.set(metricId,result);
      this._emit('analysisComputed',{kind:'structuralRobustness',metricId});
      return result;
    }

    computeFacetReplication(metricId){
      if(this.frCache.has(metricId))return this.frCache.get(metricId);
      const raw=this.getPerformanceSeries(metricId,{basis:'raw'}),result=this.semanticEngine.computeFR(raw,this._ensureTopology());
      this.frCache.set(metricId,result);
      this._emit('analysisComputed',{kind:'facetReplication',metricId});
      return result;
    }

    async _resolveScanSeries(criterion){
      if(criterion.source==='performance')return this.getPerformanceSeries(criterion.metric,{basis:criterion.basis==='percentile'?'percentile':'raw'});
      if(criterion.source==='structural_robustness')return this.computeStructuralRobustness(criterion.metric).structural_robustness;
      if(criterion.source==='facet_replication')return this.computeFacetReplication(criterion.metric).facet_replication;
      throw new Error(`Unsupported scan source ${criterion.source}`);
    }

    async runScan(scanConfig){
      const surface=this._requireResearchSurface(),config=clonePlain(scanConfig||{}),graph=this._ensureTopology();
      const result=await this.scanEngine.evaluateScan(surface,config,graph,c=>this._resolveScanSeries(c));
      if(surface!==this.researchSurface)throw new Error('Research domain changed while scan was running.');
      this.scanConfig=config;
      this.scanResult=result;
      this.regionalRobustness=null;
      this._emit('scanCompleted');
      return result;
    }

    clearScan(){
      this.scanConfig=null;
      this._invalidateScan('scanCleared');
      return this.getState();
    }

    runRegionalRobustness({performanceMask=null,minCells=1,metricIds=null,tau}={}){
      const surface=this._requireResearchSurface(),graph=this._ensureTopology();
      const mask=performanceMask||this.scanResult?.performanceMask;
      if(!mask)throw new Error('Regional Robustness requires a performance-only mask.');
      const metrics=metricIds||this.scanResult?.performanceMetrics||[];
      const args=[surface,graph,mask,Math.max(1,Math.trunc(Number(minCells)||1)),metrics,k=>this._metricInvert(k)];
      if(tau!==undefined)args.push(tau);
      const result=this.scanEngine.analyzeRegionalRobustness(...args);
      this.regionalRobustness=result;
      this._emit('regionalRobustnessComputed');
      return result;
    }

    getState(){
      const surface=this.researchSurface;
      return {
        version:VERSION,
        loaded:!!surface,
        domainRevision:this.domainRevision,
        source:{loaded:!!this.sourceSurface,rows:this.sourceSurface?.rows??null,cols:this.sourceSurface?.cols??null,studyId:this.sourceSurface?.semanticDescriptor?.study_id??null},
        researchDomain:{rows:surface?.rows??null,cols:surface?.cols??null,filtered:!!surface&&surface!==this.sourceSurface,filterSpec:clonePlain(this.filterSpec)},
        topology:this.topology?{hardSurfaceCount:this.topology.hardSurfaceCount??null,components:this.topology.components??null,undirectedEdgeCount:this.topology.undirectedEdgeCount??null}:null,
        cachedStructuralRobustness:[...this.srCache.keys()],
        cachedFacetReplication:[...this.frCache.keys()],
        scan:{active:!!this.scanResult,config:clonePlain(this.scanConfig)},
        regionalRobustness:{active:!!this.regionalRobustness}
      };
    }

    getAnalysisSnapshot(){
      return {
        version:VERSION,
        domainRevision:this.domainRevision,
        sourceSurface:this.sourceSurface,
        researchSurface:this.researchSurface,
        filterSpec:clonePlain(this.filterSpec),
        topology:this.topology,
        structuralRobustness:Object.fromEntries(this.srCache),
        facetReplication:Object.fromEntries(this.frCache),
        scanConfig:clonePlain(this.scanConfig),
        scanResult:this.scanResult,
        regionalRobustness:this.regionalRobustness
      };
    }
  }

  function createSession(options){return new SurfaceAnalyzerSession(options);}
  return {VERSION,SurfaceAnalyzerSession,createSession};
});
