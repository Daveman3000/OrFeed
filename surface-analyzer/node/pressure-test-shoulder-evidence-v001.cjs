'use strict';

const { createFilesystemRegistry, resolveRegistryRoot } = require('./surface-registry-v001.cjs');

const METRICS = ['r_per_trade','profit_factor','win_pct','max_drawdown_r','total_r'];
const SUPPORT_FIELDS = ['trades'];

function fail(message){ throw new Error(message); }

function parseArguments(argv, env=process.env){
  const args=[...argv];
  let cliRoot=null,surfaceId=null;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--registry'||arg==='--surface-id'){
      const value=args[++i];
      if(!value)fail(`${arg} requires a value.`);
      if(arg==='--registry')cliRoot=value; else surfaceId=value;
    }else fail(`Unknown argument ${arg}.`);
  }
  if(!surfaceId)fail('Usage: pressure-test-shoulder-evidence-v001.cjs [--registry <path>] --surface-id <id>');
  return {registryRoot:resolveRegistryRoot(cliRoot,env),surfaceId};
}

function quantile(values,q){
  const a=values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length)return null;
  const x=(a.length-1)*q,lo=Math.floor(x),hi=Math.ceil(x);
  return lo===hi?a[lo]:a[lo]+(a[hi]-a[lo])*(x-lo);
}

function summary(values){
  const finite=values.filter(Number.isFinite);
  if(!finite.length)return {count:0,min:null,q1:null,median:null,q3:null,max:null,iqr:null};
  const q1=quantile(finite,.25),median=quantile(finite,.5),q3=quantile(finite,.75);
  return {count:finite.length,min:Math.min(...finite),q1,median,q3,max:Math.max(...finite),iqr:q3-q1};
}

function parameterValue(def,index){ return index<0?null:def.values[index]; }
function contextObject(defs,indices,cell){
  return Object.fromEntries(defs.map(def=>[def.id,parameterValue(def,indices[def.id][cell])]));
}
function contextId(context){
  const entries=Object.entries(context);
  return entries.length?entries.map(([k,v])=>`${k}=${JSON.stringify(v)}`).join('|'):'all';
}

function collectSeries(surface,cells,source,id){
  const values=source==='metric'?surface.metrics[id]:surface.supportFields[id];
  return cells.map(cell=>values[cell]).filter(Number.isFinite);
}

function edgeEvidence({surface,cells,definition,edge}){
  if(definition.values.length<3)return {supported:false,reason:'FEWER_THAN_THREE_DECLARED_VALUES'};
  const last=definition.values.length-1;
  const levelIndices=edge==='max'?[last-2,last-1,last]:[2,1,0];
  const levels=levelIndices.map(index=>{
    const levelCells=cells.filter(cell=>surface.semanticParameterIndices[definition.id][cell]===index);
    const metrics=Object.fromEntries(METRICS.map(id=>[id,summary(collectSeries(surface,levelCells,'metric',id))]));
    const support_fields=Object.fromEntries(SUPPORT_FIELDS.map(id=>[id,summary(collectSeries(surface,levelCells,'support',id))]));
    return {
      index,
      value:definition.values[index],
      cells:levelCells.length,
      metrics,
      support_fields
    };
  });
  const deltas={};
  for(const id of METRICS){
    const a=levels[0].metrics[id].median,b=levels[1].metrics[id].median,c=levels[2].metrics[id].median;
    deltas[id]={
      edge_minus_two_in:(c==null||a==null)?null:c-a,
      edge_minus_one_in:(c==null||b==null)?null:c-b
    };
  }
  return {supported:true,levels,deltas};
}

function analyzeSurface(surface,{surfaceId=null,surfaceRecord=null}={}){
  const descriptor=surface?.semanticDescriptor;
  if(!descriptor||!surface.semanticParameterIndices||!surface.metrics)fail('Canonical semantic surface is required.');
  for(const id of METRICS)if(!surface.metrics[id])fail(`Surface is missing required metric ${id}.`);
  for(const id of SUPPORT_FIELDS)if(!surface.supportFields?.[id])fail(`Surface is missing required support field ${id}.`);

  const defs={
    regime:descriptor.parameters.filter(p=>p.topology_role==='regime'),
    facet:descriptor.parameters.filter(p=>p.topology_role==='facet'),
    ordered:descriptor.parameters.filter(p=>p.topology_role==='ordered')
  };
  if(!defs.ordered.length)fail('Shoulder evidence requires at least one ordered parameter.');

  const n=surface.rows*surface.cols,groups=new Map();
  for(let cell=0;cell<n;cell++){
    const regimeContext=contextObject(defs.regime,surface.semanticParameterIndices,cell);
    const familyContext=contextObject(defs.facet,surface.semanticParameterIndices,cell);
    const key=`${contextId(regimeContext)}::${contextId(familyContext)}`;
    if(!groups.has(key))groups.set(key,{regimeContext,familyContext,cells:[]});
    groups.get(key).cells.push(cell);
  }

  const families=[...groups.values()].map(group=>({
    regime_context_id:contextId(group.regimeContext),
    regime_context:group.regimeContext,
    family_id:contextId(group.familyContext),
    family_context:group.familyContext,
    population_cells:group.cells.length,
    ordered_edges:Object.fromEntries(defs.ordered.flatMap(def=>[
      [`${def.id}:min`,edgeEvidence({surface,cells:group.cells,definition:def,edge:'min'})],
      [`${def.id}:max`,edgeEvidence({surface,cells:group.cells,definition:def,edge:'max'})]
    ]))
  }));

  return {
    schema_version:1,
    report_type:'shoulder_evidence_v001',
    status:'post_result_exploratory_non_authoritative',
    surface:{
      surface_id:surfaceId,
      package_sha256:surfaceRecord?.sha256??null,
      study_id:descriptor.study_id,
      configurations:n
    },
    semantics:{
      scope:'within_family',
      edge_levels:3,
      aggregation:'median_across_family_cells_at_each_ordered_level',
      metrics:METRICS,
      support_fields:SUPPORT_FIELDS,
      classification:null,
      note:'Evidence only. No materiality or minimum-trades thresholds are encoded.'
    },
    parameter_roles:{
      regimes:defs.regime.map(p=>p.id),
      facets:defs.facet.map(p=>p.id),
      ordered:defs.ordered.map(p=>p.id)
    },
    families
  };
}

function run(argv=process.argv.slice(2),env=process.env){
  const {registryRoot,surfaceId}=parseArguments(argv,env);
  const registry=createFilesystemRegistry({registryRoot});
  const surfaceRecord=registry.listSurfaces().find(record=>record.surface_id===surfaceId);
  if(!surfaceRecord)fail(`Unknown surface_id ${surfaceId}.`);
  const surface=registry.resolveSurface(surfaceId);
  return analyzeSurface(surface,{surfaceId,surfaceRecord});
}

if(require.main===module){
  try{process.stdout.write(`${JSON.stringify(run(),null,2)}\n`);}
  catch(error){process.stderr.write(`${error.message}\n`);process.exitCode=1;}
}

module.exports={METRICS,SUPPORT_FIELDS,parseArguments,quantile,summary,edgeEvidence,analyzeSurface,run};
