(function(root,factory){
  'use strict';
  const API=factory();
  if(root)root.SurfaceResearchApiV001=API;
  if(typeof module!=='undefined'&&module.exports)module.exports=API;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';

  const VERSION='surface-research-api-v001';
  const SCHEMA_VERSION=1;
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const token=value=>value==null?'':String(value);

  function finiteSummary(values){
    const a=[];
    for(const value of values||[])if(Number.isFinite(value))a.push(Number(value));
    a.sort((x,y)=>x-y);
    const quantile=p=>{
      if(!a.length)return null;
      const x=(a.length-1)*p,lo=Math.floor(x),hi=Math.ceil(x);
      return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(x-lo);
    };
    let sum=0;for(const value of a)sum+=value;
    return {
      count:a.length,
      missing:Math.max(0,(values?.length||0)-a.length),
      min:a.length?a[0]:null,
      p10:quantile(.10),
      median:quantile(.50),
      mean:a.length?sum/a.length:null,
      p90:quantile(.90),
      max:a.length?a[a.length-1]:null
    };
  }

  function descriptorParameters(surface){
    const descriptor=surface?.semanticDescriptor||{};
    const layout=descriptor.layout||{};
    const axis=new Set([...(layout.x_parameter_order||[]),...(layout.y_parameter_order||[])]);
    return (descriptor.parameters||[]).filter(p=>axis.has(p.id)).map(p=>({
      id:p.id,
      label:p.label||p.id,
      topology_role:p.topology_role||null,
      source:p.source||null,
      values:clone(p.values||[])
    }));
  }

  function domainToFilterSpec(surface,domain){
    if(domain==null)return null;
    if(typeof domain!=='object'||Array.isArray(domain))throw new Error('domain must be an object keyed by parameter id.');
    const parameters=descriptorParameters(surface),defs=Object.fromEntries(parameters.map(p=>[p.id,p])),spec={};
    for(const [id,requested] of Object.entries(domain)){
      const def=defs[id];
      if(!def)throw new Error(`Unknown or non-axis domain parameter ${id}.`);
      if(!Array.isArray(requested)||!requested.length)throw new Error(`${id}: domain selection must contain at least one declared value.`);
      const indices=[];
      for(const value of requested){
        const index=def.values.findIndex(v=>token(v)===token(value));
        if(index<0)throw new Error(`${id}: undeclared domain value ${JSON.stringify(value)}.`);
        if(!indices.includes(index))indices.push(index);
      }
      spec[id]=indices.sort((a,b)=>a-b);
    }
    return spec;
  }

  function compactScan(result){
    if(!result)return null;
    const out={
      passing_cells:result.passingCells??0,
      total_cells:result.totalCells??0,
      passing_fraction:result.totalCells?result.passingCells/result.totalCells:0,
      performance_metrics:clone(result.performanceMetrics||[]),
      performance_criteria_count:result.performanceCriteriaCount??0,
      criteria:clone(result.criteria||[]),
      regions:clone(result.regions||[])
    };
    if(result.regionalRobustness){
      out.regional_robustness={
        definition:result.regionalRobustness.definition||'performance_criteria_only',
        similarity_tau:result.regionalRobustness.similarity_tau??null,
        performance_metrics:clone(result.regionalRobustness.performance_metrics||[]),
        regions:clone(result.regionalRobustness.regions||[])
      };
    }
    return out;
  }

  function normalizeMetricList(value,label){
    if(value==null)return [];
    if(!Array.isArray(value))throw new Error(`${label} must be an array of metric ids.`);
    return [...new Set(value.map(String))];
  }

  function createResearchApi({createSession,resolveSurface,listSurfaces=null,sessionOptions={}}={}){
    if(typeof createSession!=='function')throw new Error('createSession is required.');
    if(typeof resolveSurface!=='function')throw new Error('resolveSurface is required.');

    async function sessionFor(surfaceId,domain){
      if(typeof surfaceId!=='string'||!surfaceId.trim())throw new Error('surface_id is required.');
      const surface=await resolveSurface(surfaceId);
      if(!surface)throw new Error(`Unknown surface_id ${surfaceId}.`);
      const session=createSession(sessionOptions);
      await session.loadSurface(surface,{persist:false});
      const spec=domainToFilterSpec(surface,domain);
      if(spec)session.setFilter(spec);
      return {surface,session};
    }

    async function describeSurface(request){
      const {surface,session}=await sessionFor(request.surface_id,null);
      const state=session.getState();
      return {
        schema_version:SCHEMA_VERSION,
        api_version:VERSION,
        operation:'describe_surface',
        surface_id:request.surface_id,
        source_identity:state.sourceIdentity,
        study_id:surface.semanticDescriptor?.study_id??null,
        rows:surface.rows,
        cols:surface.cols,
        configurations:surface.rows*surface.cols,
        metrics:Object.keys(surface.metrics||{}),
        parameters:descriptorParameters(surface),
        provenance:clone(surface.semanticDescriptor?.provenance||{})
      };
    }

    async function analyzeSurface(request){
      const {session}=await sessionFor(request.surface_id,request.domain||null);
      const srMetrics=normalizeMetricList(request.structural_robustness,'structural_robustness');
      const frMetrics=normalizeMetricList(request.facet_replication,'facet_replication');
      const analyses={structural_robustness:{},facet_replication:{}};
      for(const metric of srMetrics){
        const result=session.computeStructuralRobustness(metric);
        analyses.structural_robustness[metric]=finiteSummary(result.structural_robustness);
      }
      for(const metric of frMetrics){
        const result=session.computeFacetReplication(metric);
        analyses.facet_replication[metric]=finiteSummary(result.facet_replication);
      }

      let scan=null;
      if(request.scan){
        const config=clone(request.scan);
        config.region_rules={...(config.region_rules||{})};
        if(request.regional_robustness===true)config.region_rules.regional_robustness=true;
        if(request.regional_robustness===false)config.region_rules.regional_robustness=false;
        scan=compactScan(await session.runScan(config));
      }else if(request.regional_robustness)throw new Error('regional_robustness requires scan criteria.');

      const state=session.getState(),filtered=session.getFilteredSurface();
      return {
        schema_version:SCHEMA_VERSION,
        api_version:VERSION,
        operation:'analyze_surface',
        surface_id:request.surface_id,
        source_identity:state.sourceIdentity,
        domain_identity:state.domainIdentity,
        domain:clone(request.domain||null),
        research_domain:{rows:filtered.rows,cols:filtered.cols,configurations:filtered.rows*filtered.cols},
        analyses,
        scan
      };
    }

    async function listSurfaceIds(){
      if(typeof listSurfaces!=='function')throw new Error('list_surfaces is unavailable because no listSurfaces adapter was configured.');
      const surfaces=await listSurfaces();
      if(!Array.isArray(surfaces))throw new Error('listSurfaces must return an array.');
      return {schema_version:SCHEMA_VERSION,api_version:VERSION,operation:'list_surfaces',surfaces:clone(surfaces)};
    }

    async function execute(request={}){
      if(!request||typeof request!=='object'||Array.isArray(request))throw new Error('Research request must be an object.');
      if(request.operation==='list_surfaces')return listSurfaceIds();
      if(request.operation==='describe_surface')return describeSurface(request);
      if(request.operation==='analyze_surface')return analyzeSurface(request);
      throw new Error(`Unsupported research operation ${request.operation||'(missing)'}.`);
    }

    return {version:VERSION,execute,describeSurface,analyzeSurface,listSurfaceIds};
  }

  return {VERSION,SCHEMA_VERSION,finiteSummary,descriptorParameters,domainToFilterSpec,compactScan,createResearchApi};
});
