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

    function clearDerived(){
      topology=null;
      topologyId='';
      srCache=new Map();
      frCache=new Map();
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
        filterSpec:filterSpec==null?null:JSON.parse(JSON.stringify(filterSpec)),
        hasTopology:!!topology,
        structuralRobustnessMetrics:[...srCache.keys()],
        facetReplicationMetrics:[...frCache.keys()],
        scanConfig:scanConfig==null?null:JSON.parse(JSON.stringify(scanConfig)),
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
      clear,
      subscribe,
      getState:stateSummary,
      getSourceSurface:()=>sourceSurface,
      getFilteredSurface:()=>filteredSurface
    };
  }

  return {VERSION,createSession,validateSurface,sourceIdentity,descriptorIdentity,stableStringify};
});
