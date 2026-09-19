'use strict';

const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const Semantic=require('../semantic-analysis-v030.js');

const DEFAULT_POLICY_PATH=path.resolve(__dirname,'../policies/exploratory/domain-cleaning-step3-v002.json');
const METRICS=['r_per_trade','profit_factor','romad'];
const compareKeys=(a,b)=>Buffer.compare(Buffer.from(a,'utf8'),Buffer.from(b,'utf8'));
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw new Error(message);};

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function canonicalBytes(value){return Buffer.from(`${JSON.stringify(canonical(value))}\n`,'utf8');}
function quantile(values,q){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const x=(sorted.length-1)*q,lo=Math.floor(x),hi=Math.ceil(x);
  return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo);
}
function loadPolicy(policyPath=DEFAULT_POLICY_PATH){
  const bytes=fs.readFileSync(policyPath),policy=JSON.parse(bytes);
  if(policy.policy_version!=='2'||policy.authoritative!==false||policy.frozen!==true)fail('Frozen non-authoritative Step-3 v002 policy is required.');
  return {policy,bytes,sha256:sha256(bytes)};
}
function definition(surface,id){
  const result=surface.semanticDescriptor?.parameters?.find(item=>item.id===id);
  if(!result)fail(`${id}: descriptor parameter is required.`);
  return result;
}
function fixedContextKey(context){return JSON.stringify(canonical(context||{}));}
function validateContext(surface,context){
  if(!context||typeof context!=='object'||Array.isArray(context))fail('fixed_context must be an object of descriptor value indices.');
  for(const [id,index] of Object.entries(context)){
    const def=definition(surface,id),values=def.values||def.ordered_values||[];
    if(!Number.isInteger(index)||index<0||index>=values.length)fail(`${id}: fixed_context index is outside the descriptor domain.`);
  }
}
function cellsMatchingContext(surface,context,N){
  const entries=Object.entries(context||{});
  return Array.from({length:N},(_,index)=>index).filter(cell=>entries.every(([id,value])=>surface.semanticParameterIndices[id][cell]===value));
}
function strictlyContiguous(indices){return indices.every((value,index)=>index===0||value===indices[index-1]+1);}

function materializeCandidateSet(surface,candidateSpecs){
  const N=surface.rows*surface.cols;
  if(!Array.isArray(candidateSpecs)||!candidateSpecs.length)fail('A nonempty predeclared candidate set is required.');
  const ids=new Set(),materialized=[],byId=new Map();
  for(let order=0;order<candidateSpecs.length;order++){
    const spec=canonical(candidateSpecs[order]);
    if(!spec.candidate_id||ids.has(spec.candidate_id))fail('Candidate IDs must be nonempty and unique.');
    ids.add(spec.candidate_id);
    if(spec.generated_after_evaluation===true)fail(`${spec.candidate_id}: post-result candidate invention is prohibited.`);
    let cells,parameterIds=[],fixedContext=spec.fixed_context||{};
    if(spec.type==='scoped_categorical_value'){
      validateContext(surface,fixedContext);
      const def=definition(surface,spec.parameter_id),values=def.values||def.ordered_values||[];
      if(def.topology_role!=='facet')fail(`${spec.candidate_id}: categorical candidates require a descriptor facet.`);
      if(Object.hasOwn(fixedContext,spec.parameter_id))fail(`${spec.candidate_id}: pruned facet must not also be fixed in context.`);
      if(!Number.isInteger(spec.value_index)||spec.value_index<0||spec.value_index>=values.length)fail(`${spec.candidate_id}: categorical value index is invalid.`);
      cells=cellsMatchingContext(surface,fixedContext,N).filter(cell=>surface.semanticParameterIndices[spec.parameter_id][cell]===spec.value_index);
      parameterIds=[spec.parameter_id];
    }else if(spec.type==='ordered_1d_boundary_tail'){
      validateContext(surface,fixedContext);
      const def=definition(surface,spec.parameter_id);
      if(def.topology_role!=='ordered')fail(`${spec.candidate_id}: 1D tails require an ordered descriptor parameter.`);
      if(!['MIN','MAX'].includes(spec.direction))fail(`${spec.candidate_id}: direction must be MIN or MAX.`);
      if(!Array.isArray(spec.value_indices)||!spec.value_indices.length||!spec.value_indices.every(Number.isInteger))fail(`${spec.candidate_id}: value_indices are required.`);
      const requested=[...new Set(spec.value_indices)].sort((a,b)=>a-b);
      if(requested.length!==spec.value_indices.length||!strictlyContiguous(requested))fail(`${spec.candidate_id}: 1D tail must be contiguous without holes.`);
      const contextCells=cellsMatchingContext(surface,fixedContext,N);
      const present=[...new Set(contextCells.map(cell=>surface.semanticParameterIndices[spec.parameter_id][cell]).filter(index=>index>=0))].sort((a,b)=>a-b);
      if(!present.length)fail(`${spec.candidate_id}: fixed context has no active values for ${spec.parameter_id}.`);
      const expected=spec.direction==='MIN'?present.slice(0,requested.length):present.slice(-requested.length);
      if(JSON.stringify(requested)!==JSON.stringify(expected)||!strictlyContiguous(expected))fail(`${spec.candidate_id}: ordered candidate is not a descriptor-adjacent boundary tail.`);
      const requestedSet=new Set(requested);
      cells=contextCells.filter(cell=>requestedSet.has(surface.semanticParameterIndices[spec.parameter_id][cell]));
      parameterIds=[spec.parameter_id];
      spec.value_indices=requested;
    }else if(spec.type==='ordered_2d_boundary_tail_intersection'){
      if('fixed_context' in spec)fail(`${spec.candidate_id}: 2D context is inherited from its parents and must not be redefined.`);
      if(!Array.isArray(spec.parent_candidate_ids)||spec.parent_candidate_ids.length!==2||new Set(spec.parent_candidate_ids).size!==2)fail(`${spec.candidate_id}: exactly two distinct parent candidates are required.`);
      const parents=spec.parent_candidate_ids.map(id=>byId.get(id));
      if(parents.some(parent=>!parent))fail(`${spec.candidate_id}: 2D parents must be previously enumerated candidates.`);
      if(parents.some(parent=>parent.spec.type!=='ordered_1d_boundary_tail'))fail(`${spec.candidate_id}: 2D parents must both be 1D boundary tails.`);
      if(fixedContextKey(parents[0].fixed_context)!==fixedContextKey(parents[1].fixed_context))fail(`${spec.candidate_id}: 2D parents must share one fixed legal context.`);
      if(parents[0].parameter_ids[0]===parents[1].parameter_ids[0])fail(`${spec.candidate_id}: 2D parents must use distinct ordered parameters.`);
      fixedContext=parents[0].fixed_context;
      parameterIds=[parents[0].parameter_ids[0],parents[1].parameter_ids[0]];
      const other=new Set(parents[1].cells);
      cells=parents[0].cells.filter(cell=>other.has(cell));
    }else fail(`${spec.candidate_id}: unsupported candidate shape ${spec.type}.`);
    if(!cells.length)fail(`${spec.candidate_id}: candidate membership is empty.`);
    const item={order,spec,candidate_id:spec.candidate_id,fixed_context:fixedContext,parameter_ids:parameterIds,cells:[...cells].sort((a,b)=>a-b)};
    materialized.push(item);byId.set(spec.candidate_id,item);
  }
  return {candidates:materialized,candidate_set_sha256:sha256(canonicalBytes(candidateSpecs))};
}

function usableCell(surface,cell,policy){
  for(const id of policy.support.required_finite_fields){
    const value=id==='trades'?surface.supportFields?.trades?.[cell]:surface.metrics?.[id]?.[cell];
    if(!Number.isFinite(value))return false;
  }
  return surface.supportFields.trades[cell]>=policy.support.minimum_trades_per_configuration
    && (!policy.support.max_drawdown_r_must_be_positive||surface.metrics.max_drawdown_r[cell]>0);
}
function jointPass(surface,cell,anchor){return METRICS.every(id=>surface.metrics[id][cell]>=anchor[id].value);}
function jointBelow(surface,cell,anchor){return METRICS.every(id=>surface.metrics[id][cell]<anchor[id].value);}
function weaknessEvidence(surface,cells,policy){
  const usable=cells.filter(cell=>usableCell(surface,cell,policy));
  const usableFraction=usable.length/cells.length;
  const medians=Object.fromEntries(METRICS.map(id=>[id,quantile(usable.map(cell=>surface.metrics[id][cell]),.5)]));
  const q75=Object.fromEntries(METRICS.map(id=>[id,quantile(usable.map(cell=>surface.metrics[id][cell]),.75)]));
  const near=policy.economic_anchors.near_p1;
  const nearCells=usable.filter(cell=>jointPass(surface,cell,near)).length;
  const belowCells=usable.filter(cell=>jointBelow(surface,cell,near)).length;
  const supported=usable.length>=policy.support.minimum_usable_cells&&usableFraction>=policy.support.minimum_usable_fraction;
  const medianWeak=supported&&METRICS.every(id=>medians[id]<=policy.broad_joint_weakness.median_maximum[id]);
  const q75Below=supported&&METRICS.filter(id=>q75[id]<near[id].value).length;
  const broadWeak=supported&&medianWeak
    && q75Below>=policy.broad_joint_weakness.q75_below_near_p1_metrics_required
    && belowCells/usable.length>=policy.broad_joint_weakness.jointly_below_near_p1_minimum_fraction
    && nearCells/usable.length<=policy.broad_joint_weakness.joint_near_p1_maximum_fraction;
  return {candidate_cells:cells.length,usable_cells:usable.length,usable_fraction:usableFraction,median:medians,q75,
    q75_below_near_p1_metrics:q75Below,jointly_below_near_p1_cells:belowCells,jointly_below_near_p1_fraction:usable.length?belowCells/usable.length:null,
    joint_near_p1_cells:nearCells,joint_near_p1_fraction:usable.length?nearCells/usable.length:null,supported,broad_weak:broadWeak};
}
function components(cells,graph,allowedMask){
  const allowed=new Set(cells.filter(cell=>allowedMask[cell])),seen=new Set(),result=[];
  for(const seed of allowed){
    if(seen.has(seed))continue;
    const queue=[seed],component=[];seen.add(seed);
    for(let at=0;at<queue.length;at++){
      const cell=queue[at];component.push(cell);
      for(let edge=graph.offsets[cell];edge<graph.offsets[cell+1];edge++){
        const neighbor=graph.neighbors[edge];
        if(allowed.has(neighbor)&&!seen.has(neighbor)){seen.add(neighbor);queue.push(neighbor);}
      }
    }
    result.push(component);
  }
  return result;
}
function qualifiesPocket(cells,surface,policy){
  if(cells.length<policy.pocket_protection.minimum_connected_cells)return false;
  let spanned=0;
  for(const def of surface.semanticDescriptor.parameters.filter(item=>item.topology_role==='ordered')){
    const values=new Set(cells.map(cell=>surface.semanticParameterIndices[def.id][cell]).filter(index=>index>=0));
    if(values.size>=policy.pocket_protection.minimum_distinct_values_per_spanned_dimension)spanned++;
  }
  return spanned>=policy.pocket_protection.minimum_ordered_dimensions_spanned;
}
function pocketVeto(surface,graph,retained,candidateCells,policy){
  const protectedCells=[];
  for(let cell=0;cell<retained.length;cell++)if(retained[cell]&&usableCell(surface,cell,policy)&&jointPass(surface,cell,policy.economic_anchors.near_p1))protectedCells.push(cell);
  const candidate=new Set(candidateCells),details=[];
  for(const component of components(protectedCells,graph,retained)){
    if(!qualifiesPocket(component,surface,policy))continue;
    const inside=component.filter(cell=>candidate.has(cell)),outside=component.filter(cell=>!candidate.has(cell));
    if(!inside.length)continue;
    if(qualifiesPocket(inside,surface,policy)||!qualifiesPocket(outside,surface,policy))details.push({component_cells:component.length,candidate_cells:inside.length,remainder_cells:outside.length});
  }
  return {veto:details.length>0,protected_components:details};
}
function affectedHardIndices(graph,cells){return new Set(cells.map(cell=>graph.hardIndex[cell]));}
function relationships(graph,facetId,retained,hardIndices){
  const set=new Set();
  for(let cell=0;cell<graph.N;cell++){
    if(!retained[cell]||!hardIndices.has(graph.hardIndex[cell]))continue;
    for(const alternative of Semantic.matchedFacetPeers(graph,cell,facetId).alternatives)for(const peer of alternative.peers){
      if(!retained[peer]||!hardIndices.has(graph.hardIndex[peer]))continue;
      set.add(cell<peer?`${cell}:${peer}`:`${peer}:${cell}`);
    }
  }
  return set;
}
function peerAudit(surface,graph,before,after,candidate,policy,requiredFacetIds){
  const hard=affectedHardIndices(graph,candidate.cells),intentionallyPruned=candidate.spec.type==='scoped_categorical_value'?candidate.spec.parameter_id:null,results=[];
  for(const facetId of requiredFacetIds){
    if(facetId===intentionallyPruned&&policy.facet_peer_eligibility.intentionally_pruned_facet_is_exempt){results.push({facet_id:facetId,status:'EXEMPT_INTENTIONALLY_PRUNED'});continue;}
    const parameterIndex=graph.info.byId[facetId]?._i;
    if(parameterIndex===undefined||!graph.info.facets.includes(parameterIndex))fail(`${facetId}: required retained facet is not a descriptor facet.`);
    const pre=relationships(graph,facetId,before,hard),post=relationships(graph,facetId,after,hard);
    if(!pre.size){results.push({facet_id:facetId,status:'NOT_APPLICABLE',pre_relationships:0,post_relationships:0});continue;}
    const values=new Set();for(let cell=0;cell<graph.N;cell++)if(after[cell]&&hard.has(graph.hardIndex[cell])&&graph.paramArrays[parameterIndex][cell]>=0)values.add(graph.paramArrays[parameterIndex][cell]);
    const fraction=post.size/pre.size;
    const pass=values.size>=policy.facet_peer_eligibility.required_retained_facet_values
      && post.size>=policy.facet_peer_eligibility.minimum_remaining_matched_relationships
      && fraction>=policy.facet_peer_eligibility.minimum_common_support_fraction_of_pre_prune;
    results.push({facet_id:facetId,status:pass?'PASS':'VETO',retained_values:values.size,pre_relationships:pre.size,post_relationships:post.size,common_support_fraction:fraction});
  }
  return {pass:results.every(item=>item.status!=='VETO'),facets:results};
}
function topologyAudit(graph,before,after,candidate,policy){
  const hard=affectedHardIndices(graph,candidate.cells),reasons=[];
  for(const parameterIndex of graph.info.ordered){
    const id=graph.info.defs[parameterIndex].id,pre=new Set(),post=new Set();
    for(let cell=0;cell<graph.N;cell++)if(hard.has(graph.hardIndex[cell])&&graph.paramArrays[parameterIndex][cell]>=0){if(before[cell])pre.add(graph.paramArrays[parameterIndex][cell]);if(after[cell])post.add(graph.paramArrays[parameterIndex][cell]);}
    if(pre.size>1&&post.size<policy.ordered_topology_eligibility.minimum_values_after_if_originally_nonsingleton)reasons.push(`${id}:TOO_FEW_VALUES`);
  }
  let preEdges=0,postEdges=0;
  for(let cell=0;cell<graph.N;cell++)if(before[cell]&&hard.has(graph.hardIndex[cell])){
    let preNeighbors=0,postNeighbors=0;
    for(let edge=graph.offsets[cell];edge<graph.offsets[cell+1];edge++){
      const neighbor=graph.neighbors[edge];if(!hard.has(graph.hardIndex[neighbor]))continue;
      if(before[neighbor]){preNeighbors++;if(neighbor>cell)preEdges++;}
      if(after[cell]&&after[neighbor]){postNeighbors++;if(neighbor>cell)postEdges++;}
    }
    if(after[cell]&&preNeighbors>0&&postNeighbors===0&&!policy.ordered_topology_eligibility.retained_cell_may_lose_all_ordered_neighbors)reasons.push(`cell:${cell}:LOST_ALL_ORDERED_NEIGHBORS`);
  }
  if(preEdges>0&&postEdges<policy.ordered_topology_eligibility.minimum_one_step_edges_after)reasons.push('NO_ONE_STEP_EDGES');
  return {pass:reasons.length===0,pre_one_step_edges:preEdges,post_one_step_edges:postEdges,reasons:[...new Set(reasons)]};
}
function filteredSurface(surface,retainedIndices){
  const take=(source,Type)=>Object.fromEntries(Object.entries(source||{}).map(([id,values])=>[id,Type.from(retainedIndices,index=>values[index])]));
  return {...surface,rows:retainedIndices.length,cols:1,
    metrics:take(surface.metrics,Float64Array),supportFields:take(surface.supportFields,Int32Array),
    semanticParameterIndices:take(surface.semanticParameterIndices,Int16Array),semanticAxis:{x:[],y:[]}};
}
function validateBindings(bindings){
  for(const id of ['surface_id','package_sha256','descriptor_sha256','surface_policy_sha256','analysis_key_version'])if(typeof bindings?.[id]!=='string'||!bindings[id])fail(`${id}: binding is required.`);
}
function cleanDomain({surface,analysisKeys,candidateSpecs,bindings,requiredFacetIds=null,policyBundle=loadPolicy()}){
  validateBindings(bindings);
  const N=surface.rows*surface.cols;
  if(!Array.isArray(analysisKeys)||analysisKeys.length!==N||analysisKeys.some(key=>typeof key!=='string'||!key||/[\r\n]/.test(key))||new Set(analysisKeys).size!==N)fail('Canonical analysisKeys must be unique and match the surface.');
  for(const id of [...METRICS,'max_drawdown_r'])if(!surface.metrics?.[id]||surface.metrics[id].length!==N)fail(`${id}: canonical metric is required.`);
  if(!surface.supportFields?.trades||surface.supportFields.trades.length!==N)fail('Canonical trades support is required.');
  const graph=Semantic.buildTopology(surface),policy=policyBundle.policy;
  const candidateSet=materializeCandidateSet(surface,candidateSpecs),retained=new Uint8Array(N);retained.fill(1);
  const facets=requiredFacetIds||graph.info.facets.map(index=>graph.info.defs[index].id),outcomes=[];
  for(const candidate of candidateSet.candidates){
    const cells=candidate.cells.filter(cell=>retained[cell]),evidence=weaknessEvidence(surface,cells,policy);
    let outcome='KEEP_UNSUPPORTED',pocket={veto:false,protected_components:[]},peer={pass:true,facets:[]},topology={pass:true,reasons:[]};
    if(evidence.supported){
      outcome=evidence.broad_weak?'PROPOSED_PRUNE':'KEEP_NOT_WEAK';
      if(outcome==='PROPOSED_PRUNE'){
        pocket=pocketVeto(surface,graph,retained,cells,policy);
        if(pocket.veto)outcome='KEEP_POCKET';
      }
      if(outcome==='PROPOSED_PRUNE'){
        const after=retained.slice();for(const cell of cells)after[cell]=0;
        peer=peerAudit(surface,graph,retained,after,candidate,policy,facets);
        if(!peer.pass)outcome='KEEP_PEER';
        if(outcome==='PROPOSED_PRUNE'){
          topology=topologyAudit(graph,retained,after,candidate,policy);
          if(!topology.pass)outcome='KEEP_TOPOLOGY';
        }
        if(outcome==='PROPOSED_PRUNE')for(const cell of cells)retained[cell]=0;
      }
    }
    outcomes.push({candidate_id:candidate.candidate_id,candidate_type:candidate.spec.type,fixed_context:candidate.fixed_context,
      parameter_ids:candidate.parameter_ids,outcome,evidence,pocket_protection:pocket,facet_peer_eligibility:peer,ordered_topology_eligibility:topology,
      proposed_cells:cells.length,removed_cells:outcome==='PROPOSED_PRUNE'?cells.length:0});
  }
  const retainedIndices=[],excludedIndices=[];for(let cell=0;cell<N;cell++)(retained[cell]?retainedIndices:excludedIndices).push(cell);
  const retainedKeys=retainedIndices.map(index=>analysisKeys[index]).sort(compareKeys),excludedKeys=excludedIndices.map(index=>analysisKeys[index]).sort(compareKeys);
  const retainedHash=sha256(Buffer.from(`${retainedKeys.join('\n')}\n`,'utf8'));
  const identityLines=['cleaned_domain_identity_v2',`source_surface_id=${bindings.surface_id}`,`source_package_sha256=${bindings.package_sha256}`,
    `descriptor_sha256=${bindings.descriptor_sha256}`,`surface_policy_sha256=${bindings.surface_policy_sha256}`,`cleaning_policy_sha256=${policyBundle.sha256}`,
    `candidate_set_sha256=${candidateSet.candidate_set_sha256}`,`analysis_key_version=${bindings.analysis_key_version}`,`topology_engine_version=${graph.version}`,
    `source_count=${N}`,`excluded_count=${excludedIndices.length}`,`retained_count=${retainedIndices.length}`,`retained_analysis_keys_sha256=${retainedHash}`,''];
  const cleanedDomainIdentity=sha256(Buffer.from(identityLines.join('\n'),'utf8'));
  const counts=Object.fromEntries(policy.outcomes.map(id=>[id,outcomes.filter(item=>item.outcome===id).length]));
  const artifact={schema_version:2,artifact_type:'cleaned_domain_artifact',policy_origin:policy.policy_origin,authoritative:false,
    source:{surface_id:bindings.surface_id,package_sha256:bindings.package_sha256,descriptor_sha256:bindings.descriptor_sha256,surface_policy_sha256:bindings.surface_policy_sha256,
      analysis_key_version:bindings.analysis_key_version,cells:N,topology_engine_version:graph.version},
    cleaning_policy:{policy_id:policy.policy_id,policy_version:policy.policy_version,sha256_exact_file_bytes:policyBundle.sha256},
    candidate_set:{candidate_count:candidateSpecs.length,candidate_set_sha256:candidateSet.candidate_set_sha256,evaluation_order:candidateSpecs.map(item=>item.candidate_id)},
    candidate_outcomes:outcomes,outcome_summary:{...counts,removed_cells:excludedIndices.length,retained_cells:retainedIndices.length},
    retained_membership:{hash_method:'sha256_utf8_lf_sorted_analysis_keys_with_final_lf',analysis_keys:retainedKeys,sha256:retainedHash},
    excluded_membership:{analysis_keys:excludedKeys},
    cleaned_domain_identity:{hash_method:'sha256_utf8_identity_preimage',identity_preimage_lines:identityLines,cleaned_domain_sha256:cleanedDomainIdentity}};
  const cleanedSurface=filteredSurface(surface,retainedIndices),cleanedGraph=Semantic.buildTopology(cleanedSurface),keysByIndex=retainedIndices.map(index=>analysisKeys[index]);
  const stage4Input={surface:cleanedSurface,graph:cleanedGraph,keysByIndex,keyToIndex:new Map(keysByIndex.map((key,index)=>[key,index])),
    physicalCellCount:N,physicalIndexByCell:Int32Array.from(retainedIndices),physicalKeysByIndex:[...analysisKeys],cleanedDomainIdentity,
    bindings:{surface_id:bindings.surface_id,package_sha256:bindings.package_sha256,descriptor_sha256:bindings.descriptor_sha256,
      surface_policy_sha256:bindings.surface_policy_sha256,cleaning_policy_sha256:policyBundle.sha256,candidate_set_sha256:candidateSet.candidate_set_sha256,
      cleaned_domain_identity:cleanedDomainIdentity,topology_engine_version:cleanedGraph.version}};
  return {artifact,stage4Input};
}

module.exports={DEFAULT_POLICY_PATH,canonical,canonicalBytes,quantile,loadPolicy,materializeCandidateSet,weaknessEvidence,cleanDomain};
