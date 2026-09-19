'use strict';

const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const Cleaner=require('../node/domain-cleaner-step3-v002.cjs');

const ROOT=path.join(__dirname,'..');
const V1=path.join(ROOT,'policies/exploratory/domain-cleaning-step3-v001.json');
const V2=path.join(ROOT,'policies/exploratory/domain-cleaning-step3-v002.json');
const VB=path.join(ROOT,'policies/exploratory/volume-bands-cleaned-domain-step3-v001.json');
const VS=path.join(ROOT,'policies/exploratory/volspike-cleaned-domain-step3-v001.json');
const SCOPES=path.join(ROOT,'policies/exploratory/volspike-step3-prune-scopes-v001.json');
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

const v1=read(V1),bundle=Cleaner.loadPolicy(V2),v2=bundle.policy;
assert.equal(sha256(fs.readFileSync(V1)),'f7229c728f5c893745d33a4faa427af7423c94ea26d83844e66b29abe5c44e71');
for(const section of ['boundary','quantiles','economic_anchors','support','broad_joint_weakness','pocket_protection','facet_peer_eligibility','ordered_topology_eligibility','outcomes'])assert.deepEqual(v2[section],v1[section],`${section} changed from v001`);
assert.equal(v2.authoritative,false);
assert.equal(v2.frozen,true);
assert.equal(v2.candidate_governance.ordered_2d.shape,'exact_membership_intersection_of_two_predeclared_ordered_1d_boundary_tail_candidates');
assert.equal(v2.candidate_governance.ordered_1d.interior_intervals_allowed,false);
assert.ok(v2.candidate_governance.prohibited.includes('post_result_candidate_invention'));

const activationSurface={semanticDescriptor:{parameters:[
  {id:'mode',topology_role:'facet',values:[0,1],active_when:'always'},
  {id:'conditional',topology_role:'ordered',values:[10,20],active_when:{op:'eq',parameter:'mode',value:1}},
  {id:'always',topology_role:'ordered',values:[0,1],active_when:'always'}
]}};
assert.doesNotThrow(()=>Cleaner.validateContext(activationSurface,{mode:0,conditional:-1}));
assert.throws(()=>Cleaner.validateContext(activationSurface,{mode:1,conditional:-1}),/parameter is active/);
assert.throws(()=>Cleaner.validateContext(activationSurface,{mode:0,always:-1}),/always-active/);
assert.doesNotThrow(()=>Cleaner.validateContext(activationSurface,{mode:1,conditional:0}));
assert.throws(()=>Cleaner.validateContext(activationSurface,{mode:0,conditional:-2}),/outside the descriptor domain/);
assert.throws(()=>Cleaner.validateContext(activationSurface,{conditional:-1}),/inactivity cannot be established/);

function makeSurface({side=5,pocket=false,permutation=null}={}){
  const descriptor={descriptor_schema_version:1,study_id:'step3-v002-synthetic',parameters:[
    {id:'reg',type:'enum',topology_role:'regime',source:'outer',values:[0],active_when:'always'},
    {id:'cat',type:'enum',topology_role:'facet',source:'outer',values:[0,1],active_when:'always'},
    {id:'x',type:'integer',topology_role:'ordered',source:'outer',values:Array.from({length:side},(_,i)=>i),active_when:'always'},
    {id:'y',type:'integer',topology_role:'ordered',source:'inner',values:Array.from({length:side},(_,i)=>i),active_when:'always'}
  ]};
  let rows=[];
  for(const cat of [0,1])for(let x=0;x<side;x++)for(let y=0;y<side;y++)rows.push({reg:0,cat,x,y});
  if(permutation)rows=permutation.map(index=>rows[index]);
  const N=rows.length,indices={};
  for(const id of ['reg','cat','x','y'])indices[id]=Int16Array.from(rows.map(row=>row[id]));
  const values=rows.map(row=>{
    const protectedPocket=pocket&&row.cat===0&&row.x<2&&row.y<4;
    const strong=row.cat===1||protectedPocket;
    return strong?{r:.8,pf:1.8,romad:2.5,dd:4,trades:60}:{r:-.2,pf:.8,romad:-.5,dd:5,trades:60};
  });
  return {
    surface:{rows:N,cols:1,semanticDescriptor:descriptor,semanticParameterIndices:indices,
      metrics:{r_per_trade:Float64Array.from(values.map(v=>v.r)),profit_factor:Float64Array.from(values.map(v=>v.pf)),
        romad:Float64Array.from(values.map(v=>v.romad)),max_drawdown_r:Float64Array.from(values.map(v=>v.dd))},
      supportFields:{trades:Int32Array.from(values.map(v=>v.trades))}},
    analysisKeys:rows.map(row=>`reg=${row.reg}|cat=${row.cat}|x=${row.x}|y=${row.y}`)
  };
}
const bindings={surface_id:'synthetic',package_sha256:'pkg',descriptor_sha256:'desc',surface_policy_sha256:'surface-policy',analysis_key_version:'v1'};
const categorical=[{candidate_id:'cat-zero',type:'scoped_categorical_value',parameter_id:'cat',value_index:0,fixed_context:{reg:0}}];

const weak=makeSurface();
const cleaned=Cleaner.cleanDomain({...weak,candidateSpecs:categorical,bindings,policyBundle:bundle});
assert.equal(cleaned.artifact.candidate_outcomes[0].outcome,'PROPOSED_PRUNE');
assert.equal(cleaned.artifact.outcome_summary.removed_cells,25);
assert.equal(cleaned.artifact.outcome_summary.retained_cells,25);
assert.equal(cleaned.artifact.retained_membership.analysis_keys.length,25);
assert.equal(cleaned.stage4Input.graph.N,25);
assert.equal(cleaned.stage4Input.bindings.cleaned_domain_identity,cleaned.artifact.cleaned_domain_identity.cleaned_domain_sha256);
assert.equal(cleaned.stage4Input.physicalCellCount,50);
assert.ok(cleaned.stage4Input.physicalIndexByCell.every(index=>index>=25));

const reverse=Array.from({length:50},(_,index)=>49-index);
const permuted=Cleaner.cleanDomain({...makeSurface({permutation:reverse}),candidateSpecs:categorical,bindings,policyBundle:bundle});
assert.equal(permuted.artifact.retained_membership.sha256,cleaned.artifact.retained_membership.sha256);
assert.equal(permuted.artifact.cleaned_domain_identity.cleaned_domain_sha256,cleaned.artifact.cleaned_domain_identity.cleaned_domain_sha256);

const protectedResult=Cleaner.cleanDomain({...makeSurface({side:10,pocket:true}),candidateSpecs:categorical,bindings,policyBundle:bundle});
assert.equal(protectedResult.artifact.candidate_outcomes[0].outcome,'KEEP_POCKET');
assert.equal(protectedResult.artifact.candidate_outcomes[0].pocket_protection.protected_components[0].candidate_cells,8);
assert.equal(protectedResult.artifact.outcome_summary.removed_cells,0);

const shapeSurface=makeSurface({side:10}).surface;
const validShapes=[
  {candidate_id:'x-min',type:'ordered_1d_boundary_tail',parameter_id:'x',direction:'MIN',value_indices:[0,1],fixed_context:{reg:0,cat:0}},
  {candidate_id:'y-max',type:'ordered_1d_boundary_tail',parameter_id:'y',direction:'MAX',value_indices:[8,9],fixed_context:{reg:0,cat:0}},
  {candidate_id:'xy-corner',type:'ordered_2d_boundary_tail_intersection',parent_candidate_ids:['x-min','y-max']}
];
const shapes=Cleaner.materializeCandidateSet(shapeSurface,validShapes).candidates;
assert.equal(shapes[0].cells.length,20);
assert.equal(shapes[1].cells.length,20);
assert.equal(shapes[2].cells.length,4);
assert.deepEqual(shapes[2].parameter_ids,['x','y']);
assert.throws(()=>Cleaner.materializeCandidateSet(shapeSurface,[{candidate_id:'interior',type:'ordered_1d_boundary_tail',parameter_id:'x',direction:'MIN',value_indices:[1,2],fixed_context:{reg:0,cat:0}}]),/not a descriptor-adjacent boundary tail/);
assert.throws(()=>Cleaner.materializeCandidateSet(shapeSurface,[{candidate_id:'hole',type:'ordered_1d_boundary_tail',parameter_id:'x',direction:'MIN',value_indices:[0,2],fixed_context:{reg:0,cat:0}}]),/without holes/);
assert.throws(()=>Cleaner.materializeCandidateSet(shapeSurface,[{candidate_id:'rectangle',type:'ordered_2d_contiguous_rectangle',fixed_context:{reg:0,cat:0}}]),/unsupported candidate shape/);
assert.throws(()=>Cleaner.materializeCandidateSet(shapeSurface,[{...validShapes[0],generated_after_evaluation:true}]),/post-result candidate invention/);
assert.throws(()=>Cleaner.materializeCandidateSet(shapeSurface,[validShapes[0],{...validShapes[1],candidate_id:'y-other',fixed_context:{reg:0,cat:1}},{candidate_id:'cross-context',type:'ordered_2d_boundary_tail_intersection',parent_candidate_ids:['x-min','y-other']}]),/share one fixed legal context/);

const vb=read(VB),vs=read(VS),scopes=read(SCOPES);
assert.equal(vb.predeclared_candidate_set.candidate_count,4);
assert.equal(vb.outcome_summary.PROPOSED_PRUNE,0);
assert.equal(vb.outcome_summary.removed_cells,0);
assert.equal(vb.outcome_summary.retained_cells,311150);
assert.equal(vs.outcome_summary.source_cells,56000);
assert.equal(vs.outcome_summary.removed_cells,14805);
assert.equal(vs.outcome_summary.retained_cells,41195);
assert.equal(vs.outcome_summary.known_35_cell_tail_removed,0);
assert.equal(scopes.scopes.length,91);
assert.equal(scopes.scope_list_sha256,'ab3565375414b05626b62245f0ef19db01cf35809e58f57b160f78fc80150e50');
assert.ok(scopes.scope_key_parameters.every(id=>!['london_range_min_points','london_range_min_atr_percent','stop_london_range_percent','fixed_target_london_range_multiple'].includes(id)));

console.log('PASS Step-3 v002 policy parity, tightened candidate grammar, deterministic cleaning, identity, and Stage-4 handoff');
