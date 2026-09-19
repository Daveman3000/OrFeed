'use strict';

const fs=require('node:fs');
const path=require('node:path');

const DEFAULT_POLICY_PATH=path.resolve(__dirname,'../policies/exploratory/shoulder-calibration-v001.json');

function fail(message){ throw new Error(message); }

function quantile(values,q){
  const sorted=values.filter(Number.isFinite).sort((a,b)=>a-b);
  if(!sorted.length)return null;
  const x=(sorted.length-1)*q,lo=Math.floor(x),hi=Math.ceil(x);
  return lo===hi?sorted[lo]:sorted[lo]+(sorted[hi]-sorted[lo])*(x-lo);
}

function median(values){ return quantile(values,.5); }

function loadPolicy(policyPath=DEFAULT_POLICY_PATH){
  return JSON.parse(fs.readFileSync(policyPath,'utf8'));
}

function iqrEpsilon(contextMedian,policy){
  const spec=policy.normalization.iqr_epsilon;
  return Math.max(spec.absolute,spec.relative_multiplier*Math.max(1,Math.abs(contextMedian)));
}

function scaleStatus(values,policy){
  const finite=values.filter(Number.isFinite);
  if(!finite.length)return {status:'UNSUPPORTED',reason:'NO_FINITE_VALUES',median:null,q1:null,q3:null,iqr:null,iqr_epsilon:null};
  const q1=quantile(finite,.25),contextMedian=median(finite),q3=quantile(finite,.75),iqr=q3-q1;
  const epsilon=iqrEpsilon(contextMedian,policy);
  return {
    status:iqr<=epsilon?'UNSUPPORTED':'SUPPORTED',
    reason:iqr<=epsilon?'IQR_AT_OR_BELOW_EPSILON':null,
    median:contextMedian,q1,q3,iqr,iqr_epsilon:epsilon
  };
}

function normalizeObservation(raw,policy){
  const normalized={...raw,metrics:{}};
  for(const [id,metric] of Object.entries(raw.metrics||{})){
    const scale=scaleStatus(metric.context_values||[],policy);
    normalized.metrics[id]={...metric,scale};
    for(const field of ['overall_gradient','preceding_slope','final_slope']){
      const value=metric[field];
      normalized.metrics[id][field]=scale.status==='SUPPORTED'&&Number.isFinite(value)?value/scale.iqr:null;
    }
  }
  return normalized;
}

function metricQualifies(metric,t){
  return metric?.scale?.status==='SUPPORTED'
    && metric.overall_gradient>=t.material_overall_gradient
    && metric.preceding_slope>=t.persistent_preceding_slope
    && metric.final_slope>=t.persistent_final_slope;
}

function metricNonAdverse(metric,t){
  return metric?.scale?.status==='SUPPORTED'
    && metric.overall_gradient>=t.non_adverse
    && metric.preceding_slope>=t.non_adverse
    && metric.final_slope>=t.non_adverse;
}

function classifyNormalizedObservation(observation,policy){
  const t=policy.thresholds;
  const primary=policy.primary_metrics.map(id=>[id,observation.metrics?.[id]]);
  const supportedPrimary=primary.filter(([,metric])=>metric?.scale?.status==='SUPPORTED');
  const supportPass=observation.support?.passes===true;
  const depth=observation.evidence_depth;
  const result={classification:'AMBIGUOUS',continuation_strength:null,qualifying_primary_metrics:[],reasons:[]};

  if(!supportPass){ result.reasons.push('INSUFFICIENT_LEVEL_SUPPORT'); return result; }
  if(depth!=='THREE_PLUS_LEVEL'){
    result.reasons.push('TWO_LEVEL_CORROBORATION_ONLY');
    return result;
  }
  if(supportedPrimary.length!==primary.length){
    result.reasons.push('PRIMARY_NORMALIZATION_UNSUPPORTED');
    return result;
  }

  const win=observation.metrics?.win_pct;
  const dd=observation.metrics?.max_drawdown_r;
  const winVeto=win?.scale?.status==='SUPPORTED'&&win.overall_gradient<=t.win_pct_tradeoff_veto;
  const ddVeto=dd?.scale?.status==='SUPPORTED'&&dd.overall_gradient>=t.max_drawdown_r_tradeoff_veto;
  if(winVeto||ddVeto){
    result.classification='ADEQUATE';
    result.reasons.push(winVeto?'WIN_PCT_TRADEOFF_VISIBLE':'MAX_DRAWDOWN_TRADEOFF_VISIBLE');
    return result;
  }

  const adverse=primary.some(([,metric])=>metric.overall_gradient<t.non_adverse||metric.final_slope<t.non_adverse);
  const flat=primary.every(([,metric])=>metric.overall_gradient<=t.flat&&metric.final_slope<=t.flat);
  const clearlyFlattened=primary.every(([,metric])=>metric.final_slope<=t.flat)
    && primary.some(([,metric])=>metric.preceding_slope>t.flat);
  if(adverse||flat||clearlyFlattened){
    result.classification='ADEQUATE';
    result.reasons.push(adverse?'ADVERSE_OR_ROLLED_OVER':flat?'FLAT':'CLEARLY_FLATTENED');
    return result;
  }

  const qualifying=primary.filter(([,metric])=>metricQualifies(metric,t));
  if(qualifying.length&&primary.every(([,metric])=>metricNonAdverse(metric,t))){
    result.classification='CLIPPED';
    result.qualifying_primary_metrics=qualifying.map(([id])=>id);
    result.continuation_strength=Math.max(...qualifying.map(([,metric])=>metric.overall_gradient));
    result.reasons.push('MATERIAL_PERSISTENT_CONTINUATION');
    return result;
  }

  result.reasons.push('WEAK_NOISY_CONFLICTING_OR_TAPERING');
  return result;
}

function classifyObservation(raw,policy=loadPolicy()){
  const normalized=normalizeObservation(raw,policy);
  return {...classifyNormalizedObservation(normalized,policy),normalized_observation:normalized};
}

function continuationTier(strength,policy){
  if(!Number.isFinite(strength))return null;
  const tier=policy.continuation_strength.tiers.find(item=>strength>=item.minimum&&(item.maximum_exclusive==null||strength<item.maximum_exclusive));
  return tier?{id:tier.id,extension_fraction_of_original_span:tier.extension_fraction_of_original_span}:null;
}

function rollupOwnershipGroup(observations,policy=loadPolicy()){
  const eligible=observations.filter(item=>item.supported===true&&item.evidence_depth==='THREE_PLUS_LEVEL');
  const clipped=eligible.filter(item=>item.classification==='CLIPPED');
  const adequate=eligible.filter(item=>item.classification==='ADEQUATE');
  const clippedFraction=eligible.length?clipped.length/eligible.length:0;
  const authorized=eligible.length>=policy.rollup.minimum_supported_three_plus_observations
    && clippedFraction>=policy.rollup.clipped_fraction
    && adequate.length===0;
  const strength=authorized?median(clipped.map(item=>item.continuation_strength)):null;
  return {
    authorized,
    supported_three_plus_observations:eligible.length,
    clipped_observations:clipped.length,
    adequate_observations:adequate.length,
    ambiguous_observations:eligible.filter(item=>item.classification==='AMBIGUOUS').length,
    two_level_corroboration_observations:observations.filter(item=>item.supported===true&&item.evidence_depth==='TWO_LEVEL').length,
    clipped_fraction:clippedFraction,
    continuation_strength:strength,
    continuation_tier:authorized?continuationTier(strength,policy):null
  };
}

function extensionForTier({originalMin,originalMax,direction,tierId,currentCumulativeFraction=0,legalValues=[]},policy=loadPolicy()){
  if(!(Number.isFinite(originalMin)&&Number.isFinite(originalMax)&&originalMax>originalMin))fail('A positive original span is required.');
  if(!['MIN','MAX'].includes(direction))fail('direction must be MIN or MAX.');
  const tier=policy.continuation_strength.tiers.find(item=>item.id===tierId);
  if(!tier)fail(`Unknown continuation tier ${tierId}.`);
  const span=originalMax-originalMin;
  const increment=tier.extension_fraction_of_original_span*span;
  const proposedCumulativeFraction=currentCumulativeFraction+tier.extension_fraction_of_original_span;
  const rawBoundary=direction==='MAX'
    ? originalMax+proposedCumulativeFraction*span
    : originalMin-proposedCumulativeFraction*span;
  const legal=legalValues.filter(Number.isFinite).sort((a,b)=>a-b);
  const roundedBoundary=!legal.length?rawBoundary:(direction==='MAX'
    ? legal.find(value=>value>=rawBoundary)??null
    : [...legal].reverse().find(value=>value<=rawBoundary)??null);
  const failedBudget=proposedCumulativeFraction>policy.rescope.maximum_cumulative_extension_per_boundary_direction||roundedBoundary==null;
  return {
    tier:tierId,direction,original_span:span,extension_increment:increment,
    proposed_cumulative_fraction:proposedCumulativeFraction,raw_boundary:rawBoundary,
    outward_rounded_legal_boundary:roundedBoundary,
    status:failedBudget?'FAILED_BUDGET':'AUTHORIZED'
  };
}

module.exports={
  DEFAULT_POLICY_PATH,quantile,median,loadPolicy,iqrEpsilon,scaleStatus,normalizeObservation,
  classifyNormalizedObservation,classifyObservation,continuationTier,rollupOwnershipGroup,extensionForTier
};
