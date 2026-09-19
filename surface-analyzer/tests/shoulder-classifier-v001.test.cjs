'use strict';

const assert=require('node:assert/strict');
const Shoulder=require('../node/shoulder-classifier-v001.cjs');

const policy=Shoulder.loadPolicy();

function scale(status='SUPPORTED'){ return {status}; }
function metric(overall,preceding,final,status='SUPPORTED'){
  return {overall_gradient:overall,preceding_slope:preceding,final_slope:final,scale:scale(status)};
}
function observation({r,pf,win=[0,0,0],dd=[0,0,0],depth='THREE_PLUS_LEVEL',support=true}){
  return {
    evidence_depth:depth,
    support:{passes:support},
    metrics:{
      r_per_trade:metric(...r),profit_factor:metric(...pf),win_pct:metric(...win),max_drawdown_r:metric(...dd)
    }
  };
}

assert.equal(Shoulder.quantile([1,2,3,4],.25),1.75);
assert.equal(Shoulder.quantile([1,2,3,4],.5),2.5);
assert.equal(Shoulder.quantile([1,2,3,4],.75),3.25);
assert.equal(Shoulder.scaleStatus([2,2,2],policy).status,'UNSUPPORTED');
assert.equal(Shoulder.scaleStatus([1,2,3],policy).status,'SUPPORTED');

const clipped=Shoulder.classifyNormalizedObservation(observation({r:[.70,.40,.50],pf:[.45,.20,.30]}),policy);
assert.equal(clipped.classification,'CLIPPED');
assert.equal(clipped.continuation_strength,.70);

const onePrimary=Shoulder.classifyNormalizedObservation(observation({r:[.70,.40,.50],pf:[0,0,0]}),policy);
assert.equal(onePrimary.classification,'CLIPPED');
assert.deepEqual(onePrimary.qualifying_primary_metrics,['r_per_trade']);

const flattened=Shoulder.classifyNormalizedObservation(observation({r:[.30,.30,.05],pf:[.20,.25,.04]}),policy);
assert.equal(flattened.classification,'ADEQUATE');
assert.deepEqual(flattened.reasons,['CLEARLY_FLATTENED']);

const tradeoff=Shoulder.classifyNormalizedObservation(observation({r:[.80,.50,.60],pf:[.70,.40,.50],win:[-.30,-.20,-.20]}),policy);
assert.equal(tradeoff.classification,'ADEQUATE');
assert.deepEqual(tradeoff.reasons,['WIN_PCT_TRADEOFF_VISIBLE']);

const unsupportedPrimary=Shoulder.classifyNormalizedObservation(observation({r:[.8,.4,.5,'UNSUPPORTED'],pf:[.7,.4,.5]}),policy);
assert.equal(unsupportedPrimary.classification,'AMBIGUOUS');
assert.deepEqual(unsupportedPrimary.reasons,['PRIMARY_NORMALIZATION_UNSUPPORTED']);

const twoLevel=Shoulder.classifyNormalizedObservation(observation({r:[1,null,1],pf:[1,null,1],depth:'TWO_LEVEL'}),policy);
assert.equal(twoLevel.classification,'AMBIGUOUS');
assert.deepEqual(twoLevel.reasons,['TWO_LEVEL_CORROBORATION_ONLY']);

const tpRollup=Shoulder.rollupOwnershipGroup([
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.784},
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.706},
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.705},
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.609}
],policy);
assert.equal(tpRollup.authorized,true);
assert.equal(tpRollup.continuation_strength,.7055);
assert.equal(tpRollup.continuation_tier.id,'MODERATE');

const s1Rollup=Shoulder.rollupOwnershipGroup([
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.504},
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.699}
],policy);
assert.equal(s1Rollup.authorized,true);
assert.ok(Math.abs(s1Rollup.continuation_strength-.6015)<1e-12);
assert.equal(s1Rollup.continuation_tier.id,'MILD');

const adequateVeto=Shoulder.rollupOwnershipGroup([
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.7},
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.8},
  {supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'ADEQUATE',continuation_strength:null}
],policy);
assert.equal(adequateVeto.clipped_fraction,2/3);
assert.equal(adequateVeto.authorized,false);

const volSpikeLike=Shoulder.rollupOwnershipGroup([
  ...Array.from({length:13},()=>({supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'CLIPPED',continuation_strength:.5})),
  ...Array.from({length:19},()=>({supported:true,evidence_depth:'THREE_PLUS_LEVEL',classification:'AMBIGUOUS',continuation_strength:null})),
  ...Array.from({length:20},()=>({supported:true,evidence_depth:'TWO_LEVEL',classification:'CLIPPED',continuation_strength:2}))
],policy);
assert.equal(volSpikeLike.supported_three_plus_observations,32);
assert.equal(volSpikeLike.clipped_fraction,13/32);
assert.equal(volSpikeLike.authorized,false);

const retry1=Shoulder.extensionForTier({originalMin:20,originalMax:100,direction:'MAX',tierId:'MODERATE',legalValues:[100,120,140,160,180]},policy);
assert.equal(retry1.status,'AUTHORIZED');
assert.equal(retry1.outward_rounded_legal_boundary,140);
const retry2=Shoulder.extensionForTier({originalMin:20,originalMax:100,direction:'MAX',tierId:'MODERATE',currentCumulativeFraction:.5,legalValues:[100,120,140,160,180]},policy);
assert.equal(retry2.status,'AUTHORIZED');
assert.equal(retry2.outward_rounded_legal_boundary,180);
const overCeiling=Shoulder.extensionForTier({originalMin:20,originalMax:100,direction:'MAX',tierId:'MODERATE',currentCumulativeFraction:.75,legalValues:[200]},policy);
assert.equal(overCeiling.status,'FAILED_BUDGET');
assert.equal(overCeiling.proposed_cumulative_fraction,1.25);

console.log('PASS  frozen shoulder classifier, conservative rollup, and extension arithmetic');
