'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ContextSpans = require('./step6-context-spans-v002.cjs');

const ROOT = path.join(__dirname, '..');
const TRAJECTORY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-trajectory-diagnostic-v001.json');
const V1_POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-selection-v001.json');
const V1_RESULT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-selection-result-v001.json');
const CONTEXT_SPANS_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-context-spans-v002.json');
const POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-ranking-v002.json');
const OUTPUT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-ranking-result-v002.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compareText = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = message => { throw new Error(message); };
const clamp = value => Math.max(0, Math.min(1, value));

function readBound(pathname, expectedHash, label) {
  const bytes = fs.readFileSync(pathname);
  if (sha256(bytes) !== expectedHash) fail(`${label} exact-byte identity mismatch.`);
  return { bytes, value: JSON.parse(bytes) };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2, lo = Math.floor(middle), hi = Math.ceil(middle);
  return lo === hi ? sorted[lo] : (sorted[lo] + sorted[hi]) / 2;
}

function orderedSpanBreadth(envelope, context) {
  const ratios = [];
  for (const [id, full] of Object.entries(context.ordered_dimensions)) {
    if (!full.applicable || full.singleton || !(full.full_cleaned_context_index_span > 0)) continue;
    const observed = envelope.topology.ordered_span[id];
    const observedSpan = observed && Number.isFinite(observed.min_index) && Number.isFinite(observed.max_index)
      ? Math.max(0, observed.max_index - observed.min_index)
      : 0;
    ratios.push(clamp(observedSpan / full.full_cleaned_context_index_span));
  }
  if (!ratios.length) fail(`${envelope.context_id}: no applicable non-singleton ordered dimensions.`);
  return { value: ratios.reduce((sum, value) => sum + value, 0) / ratios.length, dimension_ratios: ratios };
}

function frComponents(envelope) {
  const facets = Object.values(envelope.fr.facets || {});
  const applicable = facets.filter(facet => facet.evidence_status !== 'N/A');
  const supported = applicable.filter(facet => facet.evidence_status === 'APPLICABLE_SUPPORTED');
  if (!applicable.length) return { mode: 'ALL_FACETS_NA', applicable_facets: 0, supported_facets: 0, quality: null, availability: null, combined: null, supported_facet_quality: [] };
  const availability = supported.length / applicable.length;
  if (!supported.length) return { mode: 'APPLICABLE_ZERO_SUPPORTED', applicable_facets: applicable.length, supported_facets: 0, quality: null, availability, combined: null, supported_facet_quality: [] };
  const qualities = supported.map(facet => {
    const similarity = facet.structural_similarity?.value, economics = facet.peer_economics?.value;
    if (!Number.isFinite(similarity) || !Number.isFinite(economics)) fail('Supported FR facet is missing normalized similarity or peer economics.');
    return 0.5 * clamp(similarity) + 0.5 * clamp(economics);
  });
  const quality = qualities.reduce((sum, value) => sum + value, 0) / qualities.length;
  return { mode: 'SUPPORTED_APPLICABLE', applicable_facets: applicable.length, supported_facets: supported.length, quality, availability, combined: 0.8 * quality + 0.2 * availability, supported_facet_quality: qualities };
}

function scoreEnvelope(envelope, context, policy) {
  const performance = clamp(envelope.rung_index / 20);
  const sr = policy.normalization.sr[envelope.sr.band], rr = policy.normalization.rr[envelope.rr.band];
  if (!Number.isFinite(sr) || !Number.isFinite(rr)) fail(`${envelope.membership_sha256}: unsupported SR/RR band.`);
  const span = orderedSpanBreadth(envelope, context);
  const twoCore = clamp(envelope.topology.two_core.fraction);
  const size = clamp(Math.log(envelope.cell_count / 24) / Math.log(2000 / 24));
  const breadth = 0.40 * twoCore + 0.40 * span.value + 0.20 * size;
  const fr = frComponents(envelope);
  let robustness;
  if (fr.mode === 'SUPPORTED_APPLICABLE') robustness = 0.30 * sr + 0.30 * rr + 0.20 * fr.combined + 0.20 * breadth;
  else if (fr.mode === 'APPLICABLE_ZERO_SUPPORTED') robustness = 0.36 * sr + 0.36 * rr + 0.24 * breadth + 0.04 * fr.availability;
  else robustness = 0.375 * sr + 0.375 * rr + 0.25 * breadth;
  return {
    performance_score: performance,
    robustness_score: clamp(robustness),
    components: {
      sr_score: sr,
      rr_score: rr,
      fr,
      breadth: {
        score: breadth,
        two_core_breadth: twoCore,
        ordered_span_breadth: span.value,
        ordered_span_dimension_ratios: span.dimension_ratios,
        size_score: size
      }
    }
  };
}

function stabilityEligible(envelope, policy) {
  const rule = policy.role_eligibility.stability_led;
  return envelope.rung_index >= Number(rule.minimum_rung.slice(1))
    && rule.allowed_sr_bands.includes(envelope.sr.band)
    && rule.allowed_rr_bands.includes(envelope.rr.band)
    && rule.allowed_fr_bands.includes(envelope.fr.band);
}

function rankRun(candidates, weight, tolerance) {
  const ranked = candidates.map(candidate => ({
    membership_sha256: candidate.membership_sha256,
    score: weight.performance * candidate.performance_score + weight.robustness * candidate.robustness_score
  })).sort((a, b) => b.score - a.score || compareText(a.membership_sha256, b.membership_sha256));
  let groupScore = null, groupRank = 0;
  return ranked.map((item, index) => {
    if (groupScore === null || Math.abs(groupScore - item.score) > tolerance) { groupScore = item.score; groupRank = index + 1; }
    return { ...item, rank: groupRank };
  });
}

function sensitivity(candidates, weights, policy) {
  const runs = weights.map(weight => ({ ...weight, ranking: rankRun(candidates, weight, policy.ranking.numeric_tie_tolerance) }));
  const byHash = new Map(candidates.map(candidate => [candidate.membership_sha256, []]));
  for (const run of runs) for (const item of run.ranking) byHash.get(item.membership_sha256).push({ weight_id: run.id, rank: item.rank, score: item.score });
  const summaries = candidates.map(candidate => {
    const values = byHash.get(candidate.membership_sha256), ranks = values.map(item => item.rank);
    return {
      membership_sha256: candidate.membership_sha256,
      rank_by_weight: values,
      median_rank: median(ranks),
      rank_range: [Math.min(...ranks), Math.max(...ranks)],
      top_three_frequency: ranks.filter(rank => rank <= policy.ranking.shortlist_target).length / ranks.length
    };
  }).sort((a, b) => b.top_three_frequency - a.top_three_frequency || a.median_rank - b.median_rank || compareText(a.membership_sha256, b.membership_sha256));
  const topSets = runs.map(run => new Set(run.ranking.filter(item => item.rank <= policy.ranking.shortlist_target).map(item => item.membership_sha256)));
  const union = new Set(topSets.flatMap(set => [...set]));
  const intersection = new Set([...topSets[0]].filter(hash => topSets.every(set => set.has(hash))));
  const pairwise = [];
  for (let left = 0; left < topSets.length; left++) for (let right = left + 1; right < topSets.length; right++) {
    const both = [...topSets[left]].filter(hash => topSets[right].has(hash)).length;
    const either = new Set([...topSets[left], ...topSets[right]]).size;
    pairwise.push({ left: runs[left].id, right: runs[right].id, jaccard: either ? both / either : 1 });
  }
  return {
    runs,
    candidate_sensitivity: summaries,
    top_three_stability: {
      union_membership_sha256: [...union].sort(compareText),
      intersection_membership_sha256: [...intersection].sort(compareText),
      identical_across_weights: topSets.every(set => set.size === topSets[0].size && [...set].every(hash => topSets[0].has(hash))),
      pairwise_jaccard: pairwise
    }
  };
}

function buildArtifact() {
  const policyBytes = fs.readFileSync(POLICY_PATH), policy = JSON.parse(policyBytes);
  const trajectoryBound = readBound(TRAJECTORY_PATH, policy.source_binding.trajectory_artifact_sha256, 'Trajectory artifact');
  const v1PolicyBound = readBound(V1_POLICY_PATH, policy.source_binding.v001_policy_sha256, 'v1 policy');
  const v1ResultBound = readBound(V1_RESULT_PATH, policy.source_binding.v001_result_sha256, 'v1 result');
  const contextBound = readBound(CONTEXT_SPANS_PATH, policy.source_binding.context_span_artifact_sha256, 'Context-span artifact');
  ContextSpans.verifyArtifact(contextBound.value);
  if (contextBound.value.artifact_identity.payload_sha256 !== policy.source_binding.context_span_payload_sha256) fail('Context-span payload binding mismatch.');
  if (!v1PolicyBound.value.frozen || policy.scope.v001_eligibility_is_immutable !== true) fail('Frozen v1 eligibility is required.');
  if (trajectoryBound.value.total_unique_envelopes !== policy.source_binding.required_unique_envelopes || trajectoryBound.value.total_terminal_structures !== policy.source_binding.required_terminal_structures) fail('Trajectory coverage mismatch.');

  const trajectoryCases = new Map(trajectoryBound.value.cases.map(item => [item.calibration_case, item]));
  const contextCases = new Map(contextBound.value.cases.map(item => [item.calibration_case, item]));
  const cases = v1ResultBound.value.cases.map(v1Case => {
    const trajectoryCase = trajectoryCases.get(v1Case.calibration_case), contextCase = contextCases.get(v1Case.calibration_case);
    if (!trajectoryCase || !contextCase) fail(`${v1Case.calibration_case}: missing trajectory or context-span case.`);
    const required = policy.source_binding.required_v001_pre_frontier_candidates[v1Case.calibration_case];
    if (v1Case.exact_membership_candidates.length !== required) fail(`${v1Case.calibration_case}: v1 pre-frontier candidate coverage mismatch.`);
    const contextById = new Map(contextCase.contexts.map(item => [item.context_id, item]));
    const candidates = v1Case.exact_membership_candidates.map(candidate => {
      const envelope = trajectoryCase.envelopes[candidate.membership_sha256];
      if (!envelope || envelope.cell_count !== candidate.cell_count || envelope.rung !== candidate.rung) fail(`${candidate.membership_sha256}: candidate-to-envelope mismatch.`);
      const context = contextById.get(envelope.context_id);
      if (!context) fail(`${envelope.context_id}: context-span denominator is missing.`);
      const scores = scoreEnvelope(envelope, context, policy);
      return {
        membership_sha256: candidate.membership_sha256,
        context_id: envelope.context_id,
        rung: envelope.rung,
        cell_count: envelope.cell_count,
        v001_roles: candidate.roles,
        descendant_terminal_regions: candidate.descendant_terminal_regions,
        role_eligibility: { performance_led: true, stability_led: stabilityEligible(envelope, policy) },
        ...scores
      };
    });
    const performance = sensitivity(candidates, policy.weight_sensitivity.performance_led, policy);
    const stabilityCandidates = candidates.filter(candidate => candidate.role_eligibility.stability_led);
    const stability = sensitivity(stabilityCandidates, policy.weight_sensitivity.stability_led, policy);
    return {
      calibration_case: v1Case.calibration_case,
      bindings: {
        cleaned_domain_identity: contextCase.cleaned_domain_identity,
        descriptor_sha256: contextCase.descriptor_sha256,
        topology_engine_version: contextCase.topology_engine_version,
        topology_sha256: contextCase.topology_sha256
      },
      eligible_consolidated_candidates: candidates.length,
      stability_role_candidates: stabilityCandidates.length,
      candidates,
      rankings: { performance_led: performance, stability_led: stability }
    };
  });
  return {
    schema_version: 2,
    artifact_type: 'step6_role_ranking_calibration',
    policy_origin: 'post_result_exploratory',
    authoritative: false,
    final_step7_shortlist_frozen: false,
    source_trajectory_sha256: sha256(trajectoryBound.bytes),
    source_v001_policy_sha256: sha256(v1PolicyBound.bytes),
    source_v001_result_sha256: sha256(v1ResultBound.bytes),
    context_span_artifact_sha256: sha256(contextBound.bytes),
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    policy_sha256: sha256(policyBytes),
    cases
  };
}

function main() {
  const artifact = buildArtifact();
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_PATH, bytes);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, artifact_sha256: sha256(bytes), policy_sha256: artifact.policy_sha256, cases: artifact.cases.map(item => ({ calibration_case: item.calibration_case, performance_candidates: item.eligible_consolidated_candidates, stability_candidates: item.stability_role_candidates, performance_top3_stable: item.rankings.performance_led.top_three_stability.identical_across_weights, stability_top3_stable: item.rankings.stability_led.top_three_stability.identical_across_weights })) }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { orderedSpanBreadth, frComponents, scoreEnvelope, stabilityEligible, rankRun, sensitivity, buildArtifact };
