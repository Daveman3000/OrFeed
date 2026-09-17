(function(root,factory){
  'use strict';
  const API=factory();
  if(root)root.SurfaceAnalyzerSessionV001=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const VERSION='surface-analyzer-session-v001';
  const DEFAULT_ACTIVE_KEY='active-surface';

  function stableStringify(value){
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return `[${value.map(stableStringify).join(',')}]`;
    const keys=Object.keys(value).sort();
    return `{${keys.map(k=>`${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }

  function cloneJson(value){return value==null?value:JSON.parse(JSON.stringify(value));}

  function sourceIdentity(surface){
    const d=surface?.semanticDescriptor||{},p=d.provenance||{};
    const sourceHash=p.source_sha256||p.source?.sha256||p.semantic_csv_sha256||p.canonical_results_sha256||'';
    if(sourceHash)return `${d.study_id||'surface'}:sha:${sourceHash}`;
    const run=[p.job_id,p.run_id,p.data_generation_id,p.backtester_build].filter(v=>v!=null&&v!=='').join('|');
    if(run)return `${d.study_id||'surface'}:run:${run}`;
    return `${d.study_id||'surface'}:file:${surface?.fileName||'surface'}|${surface?.fileSize||0}|${surface?.rows||0}x${surface?.cols||0}`;
  }

  function descriptorIdentity(surface){
    const d=surface?.semanticDescriptor||null;
    if(!d)return '';
    return stableStringify({
      descriptor_schema_version:d.descriptor_schema_version??null,
      descriptor_version:d.descriptor_version??null,
      study_id:d.study_id??null,
      parameters:d.parameters||[],
      layout:d.layout||{}
    });
  }

  function validateSurface(surface){
    if(!surface||typeof surface!=='object')throw new Error('Surface is required.');
    if(!Number.isInteger(surface.rows)||surface.rows<=0)throw new Error('Surface rows must be a positive integer.');
    if(!Number.isInteger(surface.cols)||surface.cols<=0)throw new Error('Surface cols must be a positive integer.');
    if(!surface.metrics||typeof surface.metrics!=='object')throw new Error('Surface metrics are required.');
    const n=surface.rows*surface.cols;
    for(const [metric,values] of Object.entries(surface.metrics)){
      if(!values||values.length!==n)throw new Error(`${metric}: metric length must equal rows × cols.`);
    }
    const supportDeclarations=surface.semanticDescriptor?.results?.support_fields||[];
    if(!Array.isArray(supportDeclarations))throw new Error('Semantic descriptor support_fields must be an array.');
    const declaredSupport=new Set();
    for(const field of supportDeclarations){
      if(!field||typeof field!=='object'||Array.isArray(field)||typeof field.id!=='string'||!field.id)throw new Error('Semantic descriptor support_fields entries must be typed objects.');
      if(field.type!=='integer')throw new Error(`${field.id}: unsupported support field type ${field.type||'(missing)'}.`);
      if(typeof field.role!=='string'||!field.role)throw new Error(`${field.id}: support field role is required.`);
      if(declaredSupport.has(field.id))throw new Error(`${field.id}: duplicate support field declaration.`);
      declaredSupport.add(field.id);
      const values=surface.supportFields?.[field.id];
      if(!(values instanceof Int32Array))throw new Error(`${field.id}: integer support field must be an Int32Array.`);
      if(values.length!==n)throw new Error(`${field.id}: support field length must equal rows × cols.`);
    }
    for(const field of Object.keys(surface.supportFields||{}))if(!declaredSupport.has(field))throw new Error(`${field}: undeclared support field.`);
    if(surface.semanticDescriptor){
      if(!surface.semanticParameterIndices||typeof surface.semanticParameterIndices!=='object')throw new Error('Semantic surfaces require semanticParameterIndices.');
      for(const [id,values] of Object.entries(surface.semanticParameterIndices)){
        if(!values||values.length!==n)throw new Error(`${id}: semantic parameter length must equal rows × cols.`);
      }
    }
    return surface;
  }

  function createSession(options={}){
    const storageAdapter=options.storageAdapter||null;
    const filterEngine=options.filterEngine||null;
    const semanticEngine=options.semanticEngine||null;
    const scanEngine=options.scanEngine||null;
    const metricMetadata=options.metricMetadata||{};
    const activeKey=options.activeKey||DEFAULT_ACTIVE_KEY;
    const listeners=new Set();
    let revision=0;
    let sourceSurface=null;
    let filteredSurface=null;
    let filterSpec=null;
    let sourceId='';
    let descriptorId='';
    let domainId='';
    let topologyId='';
    let topology=null;
    let scanConfig=null;
    let scanResult=null;
    let regionalRobustnessResult=null;
    let srCache=new Map();
    let frCache=new Map();
    let percentileCache=new Map();

    function clearDerived(){
      topology=null;
      topologyId='';
      srCache=new Map();
      frCache=new Map();
      percentileCache=new Map();
      scanResult=null;
      regionalRobustnessResult=null;
    }

    function stateSummary(){
      return {
        version:VERSION,
        revision,
        hasSurface:!!sourceSurface,
        sourceIdentity:sourceId,
        descriptorIdentity:descriptorId,
        domainIdentity:domainId,
        topologyIdentity:topologyId,
        filterSpec:cloneJson(filterSpec),
        hasTopology:!!topology,
        structuralRobustnessMetrics:[...srCache.keys()],
        facetReplicationMetrics:[...frCache.keys()],
        scanConfig:cloneJson(scanConfig),
        hasScanResult:!!scanResult,
        hasRegionalRobustnessResult:!!regionalRobustnessResult
      };
    }

    function emit(type,detail={}){
      const event={type,detail,revision,state:stateSummary()};
      for(const listener of [...listeners])listener(event);
    }

    function commitSource(surface){
      sourceSurface=surface;
      filteredSurface=surface;
      filterSpec=null;
      sourceId=sourceIdentity(surface);
      descriptorId=descriptorIdentity(surface);
      domainId=`${sourceId}|filter:none`;
      scanConfig=null;
      clearDerived();
      revision++;
      emit('surfaceLoaded',{sourceIdentity:sourceId});
    }

    function commitDomain(surface,spec,eventType){
      filteredSurface=surface;
      filterSpec=spec;
      domainId=spec==null?`${sourceId}|filter:none`:`${sourceId}|filter:${stableStringify(spec)}`;
      clearDerived();
      revision++;
      emit(eventType,{domainIdentity:domainId});
    }

    async function loadSurface(surface,{persist=false}={}){
      const candidate=validateSurface(surface);
      if(persist){
        if(!storageAdapter?.set)throw new Error('Persistence requested but storageAdapter.set is unavailable.');
        await storageAdapter.set(activeKey,candidate);
      }
      commitSource(candidate);
      return stateSummary();
    }

    async function restore(){
      if(!storageAdapter?.get)throw new Error('Restore requested but storageAdapter.get is unavailable.');
      const stored=await storageAdapter.get(activeKey);
      if(!stored)return null;
      return loadSurface(stored,{persist:false});
    }

    function setFilter(spec){
      if(!sourceSurface)throw new Error('No surface is loaded.');
      if(!filterEngine?.normalizeFilterSpec||!filterEngine?.activeFilters||!filterEngine?.applySurfaceFilter)throw new Error('Surface Filter engine is unavailable.');
      const normalized=filterEngine.normalizeFilterSpec(sourceSurface,spec||{});
      if(!filterEngine.activeFilters(sourceSurface,normalized))return clearFilter();
      const candidate=validateSurface(filterEngine.applySurfaceFilter(sourceSurface,normalized));
      commitDomain(candidate,normalized,'filterChanged');
      return stateSummary();
    }

    function clearFilter(){
      if(!sourceSurface)throw new Error('No surface is loaded.');
      if(filterSpec==null&&filteredSurface===sourceSurface)return stateSummary();
      commitDomain(sourceSurface,null,'filterCleared');
      return stateSummary();
    }

    function ensureTopology(){
      if(!filteredSurface)throw new Error('No surface is loaded.');
      if(!filteredSurface.semanticDescriptor||!filteredSurface.semanticParameterIndices)throw new Error('Current surface has no semantic topology.');
      if(!semanticEngine?.buildTopology)throw new Error('Semantic analysis engine is unavailable.');
      const expectedId=`${domainId}|descriptor:${descriptorId}`;
      if(topology&&topologyId===expectedId)return topology;
      const candidate=semanticEngine.buildTopology(filteredSurface);
      topology=candidate;
      topologyId=expectedId;
      emit('topologyComputed',{topologyIdentity:topologyId});
      return topology;
    }

    function metricValues(metricId){
      if(!filteredSurface)throw new Error('No surface is loaded.');
      const values=filteredSurface.metrics?.[metricId];
      if(!values)throw new Error(`Surface does not contain ${metricId}.`);
      return values;
    }

    function invertMetric(metricId){return !!metricMetadata?.[metricId]?.invert;}

    function getPerformanceSeries(metricId,{basis='raw'}={}){
      const raw=metricValues(metricId);
      if(basis==='raw')return raw;
      if(basis!=='percentile')throw new Error(`Unsupported performance basis ${basis}.`);
      if(!scanEngine?.midrankPercentile)throw new Error('Scan engine cannot compute performance percentiles.');
      const key=`${metricId}|${invertMetric(metricId)?1:0}`;
      if(!percentileCache.has(key))percentileCache.set(key,scanEngine.midrankPercentile(raw,invertMetric(metricId)));
      return percentileCache.get(key);
    }

    function computeStructuralRobustness(metricId){
      if(srCache.has(metricId))return srCache.get(metricId);
      if(!semanticEngine?.computeSR)throw new Error('Semantic analysis engine cannot compute Structural Robustness.');
      const candidate=semanticEngine.computeSR(metricValues(metricId),ensureTopology());
      srCache.set(metricId,candidate);
      emit('analysisComputed',{analysis:'structural_robustness',metricId});
      return candidate;
    }

    function computeFacetReplication(metricId){
      if(frCache.has(metricId))return frCache.get(metricId);
      if(!semanticEngine?.computeFR)throw new Error('Semantic analysis engine cannot compute Facet Replication.');
      const candidate=semanticEngine.computeFR(metricValues(metricId),ensureTopology());
      frCache.set(metricId,candidate);
      emit('analysisComputed',{analysis:'facet_replication',metricId});
      return candidate;
    }

    async function resolveScanSeries(criterion){
      if(criterion.source==='performance')return getPerformanceSeries(criterion.metric,{basis:criterion.basis==='percentile'?'percentile':'raw'});
      if(criterion.source==='structural_robustness')return computeStructuralRobustness(criterion.metric).structural_robustness;
      if(criterion.source==='facet_replication')return computeFacetReplication(criterion.metric).facet_replication;
      throw new Error(`Unsupported scan source ${criterion.source}.`);
    }

    async function runScan(config){
      if(!filteredSurface?.semanticDescriptor)throw new Error('No semantic surface loaded.');
      if(!scanEngine?.evaluateScan)throw new Error('Scan engine is unavailable.');
      const candidateConfig=cloneJson(config||{});
      const startRevision=revision,startDomain=domainId,surface=filteredSurface,g=ensureTopology();
      const candidate=await scanEngine.evaluateScan(surface,candidateConfig,g,resolveScanSeries);
      if(candidateConfig.region_rules?.regional_robustness){
        if(!candidate.performanceMask)throw new Error('Regional Robustness requires at least one Performance criterion.');
        if(!scanEngine?.analyzeRegionalRobustness)throw new Error('Scan engine cannot compute Regional Robustness.');
        candidate.regionalRobustness=scanEngine.analyzeRegionalRobustness(
          surface,
          g,
          candidate.performanceMask,
          Math.max(1,Math.trunc(Number(candidateConfig.region_rules?.min_cells)||1)),
          candidate.performanceMetrics,
          invertMetric,
          semanticEngine?.TAU
        );
      }
      delete candidate.performanceMask;
      if(revision!==startRevision||domainId!==startDomain||filteredSurface!==surface)throw new Error('Surface or research domain changed while scan was running. Apply again.');
      scanConfig=candidateConfig;
      scanResult=candidate;
      regionalRobustnessResult=candidate.regionalRobustness||null;
      revision++;
      emit('scanApplied',{passingCells:candidate.passingCells,regions:candidate.regions.length});
      return candidate;
    }

    function clearScan(){
      if(!scanResult&&!regionalRobustnessResult)return stateSummary();
      scanResult=null;
      regionalRobustnessResult=null;
      revision++;
      emit('scanCleared');
      return stateSummary();
    }

    async function clear({removePersisted=false}={}){
      if(removePersisted){
        if(!storageAdapter?.remove)throw new Error('Persistent clear requested but storageAdapter.remove is unavailable.');
        await storageAdapter.remove(activeKey);
      }
      sourceSurface=null;
      filteredSurface=null;
      filterSpec=null;
      sourceId='';
      descriptorId='';
      domainId='';
      scanConfig=null;
      clearDerived();
      revision++;
      emit('surfaceCleared');
      return stateSummary();
    }

    function subscribe(listener){
      if(typeof listener!=='function')throw new Error('Session listener must be a function.');
      listeners.add(listener);
      return ()=>listeners.delete(listener);
    }

    return {
      version:VERSION,
      loadSurface,
      restore,
      setFilter,
      clearFilter,
      ensureTopology,
      getPerformanceSeries,
      computeStructuralRobustness,
      computeFacetReplication,
      runScan,
      clearScan,
      clear,
      subscribe,
      getState:stateSummary,
      getSourceSurface:()=>sourceSurface,
      getFilteredSurface:()=>filteredSurface,
      getTopology:()=>topology,
      getScanResult:()=>scanResult,
      getRegionalRobustnessResult:()=>regionalRobustnessResult
    };
  }

  return {VERSION,createSession,validateSurface,sourceIdentity,descriptorIdentity,stableStringify};
});
