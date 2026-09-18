'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Frozen = require('./frozen-anchor-v001.cjs');
const VolSpike = require('./volspike-calibration-v001.cjs');

const ROOT = path.join(__dirname, '..');
const REGISTRY = path.join(ROOT, 'registry');
const POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step5-robustness-adjudication-v001.json');
const OUTPUT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step5-joint-calibration-v001.json');
const INPUTS = [
  {
    calibration_case: 'volume_bands',
    evidence_path: path.join(ROOT, 'policies', 'exploratory', 'volume-bands-step5-anchor-evidence-v002.json'),
    anchors_path: path.join(ROOT, 'policies', 'exploratory', 'volume-bands-step4-frozen-anchors-v001.json'),
    load: () => Frozen.loadVolumeBands(REGISTRY)
  },
  {
    calibration_case: 'volspike',
    evidence_path: path.join(ROOT, 'policies', 'exploratory', 'volspike-step5-anchor-evidence-v001.json'),
    anchors_path: path.join(ROOT, 'policies', 'exploratory', 'volspike-step4-frozen-anchors-v001.json'),
    load: () => VolSpike.loadVolSpike(REGISTRY)
  }
];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const countBy = (values, key) => values.reduce((out, value) => {
  const id = typeof key === 'function' ? key(value) : value[key];
  out[id] = (out[id] || 0) + 1;
  return out;
}, {});

function band(value, strong, moderate, lowName) {
  return value >= strong ? 'STRONG' : value >= moderate ? 'MODERATE' : lowName;
}

function assertBindings(policy, input, evidenceBytes) {
  const key = input.calibration_case === 'volume_bands' ? 'volume_bands_evidence_sha256' : 'volspike_evidence_sha256';
  if (sha256(evidenceBytes) !== policy.calibration_bindings[key]) fail(`${input.calibration_case}: evidence identity mismatch.`);
  const evidence = JSON.parse(evidenceBytes);
  if (evidence.evidence_schema_sha256 !== policy.calibration_bindings.evidence_schema_sha256) fail(`${input.calibration_case}: evidence schema mismatch.`);
  return evidence;
}

function srState(result, metrics, policy) {
  const complete = metrics.every(metric => {
    const score = result.sr[metric], coverage = result.sr_decomposition[metric].neighbor_coverage;
    return score.count === result.rr.cell_count && score.missing === 0 && Number.isFinite(score.median) && coverage.count === result.rr.cell_count && coverage.missing === 0 && Number.isFinite(coverage.min);
  });
  if (!complete) return { evidence_status: 'INSUFFICIENT', band: 'INSUFFICIENT' };
  const minimumMedian = Math.min(...metrics.map(metric => result.sr[metric].median));
  const thresholds = policy.bands.sr;
  return { evidence_status: 'SUFFICIENT', band: band(minimumMedian, thresholds.STRONG.minimum, thresholds.MODERATE.minimum, 'SENSITIVE'), minimum_metric_median: minimumMedian };
}

function rrState(result, metrics, policy) {
  const complete = metrics.every(metric => {
    const value = result.rr.metrics[metric];
    return value.interior_edges > 0 && value.boundary_edges > 0 && ['interior_similarity', 'boundary_worse_fraction', 'boundary_mean_normalized_drop'].every(key => Number.isFinite(value[key]));
  });
  if (!complete) return { evidence_status: 'INSUFFICIENT', band: 'INSUFFICIENT' };
  const interior = Math.min(...metrics.map(metric => result.rr.metrics[metric].interior_similarity));
  const boundary = Math.min(...metrics.map(metric => result.rr.metrics[metric].boundary_worse_fraction));
  const positiveDrops = metrics.every(metric => result.rr.metrics[metric].boundary_mean_normalized_drop > 0);
  const thresholds = policy.bands.rr;
  let rrBand = 'WEAK';
  if (positiveDrops && interior >= thresholds.STRONG.minimum_interior_similarity && boundary >= thresholds.STRONG.minimum_boundary_worse_fraction) rrBand = 'STRONG';
  else if (positiveDrops && interior >= thresholds.MODERATE.minimum_interior_similarity && boundary >= thresholds.MODERATE.minimum_boundary_worse_fraction) rrBand = 'MODERATE';
  return { evidence_status: 'SUFFICIENT', band: rrBand, minimum_interior_similarity: interior, minimum_boundary_worse_fraction: boundary, all_boundary_drops_positive: positiveDrops };
}

function frState(result, metrics, policy) {
  const facets = {};
  let applicable = 0, supported = 0;
  for (const [id, value] of Object.entries(result.fr)) {
    if (value.evidence_status === 'N/A') { facets[id] = { evidence_status: 'N/A' }; continue; }
    applicable++;
    if (value.evidence_status === 'UNSUPPORTED') { facets[id] = { evidence_status: 'APPLICABLE_UNSUPPORTED' }; continue; }
    supported++;
    const similarity = Math.min(...metrics.map(metric => value.structural_replication[metric].similarity.median));
    const coverage = value.anchor_cells_with_matched_peer / value.applicable_anchor_cells;
    const economics = value.economic_replication.joint_p1_peer_cells / value.unique_matched_peers;
    const thresholds = policy.bands.fr_per_supported_facet;
    facets[id] = {
      evidence_status: 'APPLICABLE_SUPPORTED',
      structural_similarity: { value: similarity, band: band(similarity, thresholds.structural_similarity.STRONG.minimum, thresholds.structural_similarity.MODERATE.minimum, 'LOW') },
      peer_coverage: { value: coverage, band: band(coverage, thresholds.peer_coverage.STRONG.minimum, thresholds.peer_coverage.MODERATE.minimum, 'LOW') },
      peer_economics: { value: economics, band: band(economics, thresholds.peer_economics.STRONG.minimum, thresholds.peer_economics.MODERATE.minimum, 'WEAK') }
    };
  }
  if (!applicable) return { band: 'N/A', applicable_facets: 0, supported_facets: 0, facets };
  if (!supported) return { band: 'INSUFFICIENT', applicable_facets: applicable, supported_facets: 0, facets };
  const states = Object.values(facets).filter(value => value.evidence_status === 'APPLICABLE_SUPPORTED');
  if (states.some(value => value.peer_economics.band === 'WEAK')) return { band: 'ECONOMICALLY_WEAK', applicable_facets: applicable, supported_facets: supported, facets };
  const allStrong = states.every(value => value.structural_similarity.band === 'STRONG' && value.peer_coverage.band === 'STRONG' && value.peer_economics.band === 'STRONG');
  if (allStrong) return { band: 'STRONG', applicable_facets: applicable, supported_facets: supported, facets };
  const allAdequate = states.every(value => value.structural_similarity.band !== 'LOW' && value.peer_coverage.band !== 'LOW' && value.peer_economics.band !== 'WEAK');
  if (allAdequate) return { band: 'ADEQUATE', applicable_facets: applicable, supported_facets: supported, facets };
  const viableButDivergent = states.every(value => value.peer_coverage.band !== 'LOW' && value.peer_economics.band !== 'WEAK') && states.some(value => value.structural_similarity.band === 'LOW');
  return { band: viableButDivergent ? 'DIVERGENT_VIABLE' : 'MIXED', applicable_facets: applicable, supported_facets: supported, facets };
}

function boundaryIndex(bundle) {
  const contexts = new Map();
  for (let index = 0; index < bundle.graph.N; index++) {
    const contextId = bundle.fixed.map(parameter => bundle.surface.semanticParameterIndices[parameter.id][index]).join(',');
    if (!contexts.has(contextId)) contexts.set(contextId, {});
    const bounds = contexts.get(contextId);
    for (const parameterIndex of bundle.graph.info.ordered) {
      const id = bundle.graph.info.defs[parameterIndex].id, value = bundle.surface.semanticParameterIndices[id][index];
      if (value < 0) continue;
      if (!bounds[id]) bounds[id] = { min: value, max: value };
      else { bounds[id].min = Math.min(bounds[id].min, value); bounds[id].max = Math.max(bounds[id].max, value); }
    }
  }
  return contexts;
}

function boundaryConditioning(bundle, anchor, contexts = boundaryIndex(bundle)) {
  const cells = anchor.analysis_keys.map(key => bundle.keyToIndex.get(key));
  if (cells.some(index => index === undefined)) fail(`${anchor.region_id}: anchor key is outside its cleaned domain.`);
  const contextId = bundle.fixed.map(parameter => bundle.surface.semanticParameterIndices[parameter.id][cells[0]]).join(',');
  const contextBounds = contexts.get(contextId);
  if (!contextBounds) fail(`${anchor.region_id}: fixed context is absent from the cleaned domain.`);
  const output = {};
  for (const parameterIndex of bundle.graph.info.ordered) {
    const id = bundle.graph.info.defs[parameterIndex].id;
    const values = bundle.surface.semanticParameterIndices[id];
    const member = cells.map(index => values[index]).filter(value => value >= 0);
    const domain = contextBounds[id];
    if (!domain || !member.length) { output[id] = { evidence_status: 'N/A' }; continue; }
    const domainMin = domain.min, domainMax = domain.max, memberMin = Math.min(...member), memberMax = Math.max(...member);
    output[id] = {
      evidence_status: 'SUPPORTED',
      touches_min: memberMin === domainMin,
      touches_max: memberMax === domainMax,
      pinned_single_value_at_min: memberMin === memberMax && memberMin === domainMin,
      pinned_single_value_at_max: memberMin === memberMax && memberMax === domainMax
    };
  }
  return output;
}

function profileFor(sr, rr, fr) {
  if (sr.band === 'INSUFFICIENT' || rr.band === 'INSUFFICIENT' || fr.band === 'INSUFFICIENT') return 'INSUFFICIENT_EVIDENCE';
  const frAdverse = fr.band === 'ECONOMICALLY_WEAK' || fr.band === 'MIXED';
  if (rr.band === 'STRONG' && sr.band === 'SENSITIVE' && !frAdverse) return 'REGIONALLY_COHERENT_LOCALLY_SENSITIVE';
  if (rr.band === 'STRONG' && (sr.band === 'STRONG' || sr.band === 'MODERATE') && (fr.band === 'STRONG' || fr.band === 'ADEQUATE' || fr.band === 'N/A')) return 'BROAD_LOCAL_STRUCTURE_STRONG';
  if (rr.band === 'WEAK' && (sr.band === 'STRONG' || sr.band === 'MODERATE') && !frAdverse) return 'LOCALLY_SMOOTH_REGIONALLY_WEAK';
  return 'MIXED_AMBIGUOUS';
}

function adjudicateCase(input, policy) {
  const evidenceBytes = fs.readFileSync(input.evidence_path), evidence = assertBindings(policy, input, evidenceBytes);
  const anchorBytes = fs.readFileSync(input.anchors_path), anchorArtifact = JSON.parse(anchorBytes), bundle = input.load();
  if (evidence.anchor_artifact_sha256 !== sha256(anchorBytes)) fail(`${input.calibration_case}: anchor artifact identity mismatch.`);
  const anchors = new Map(anchorArtifact.anchors.map(anchor => [anchor.region_id, anchor]));
  const contexts = boundaryIndex(bundle);
  const results = evidence.results.map(result => {
    const anchor = anchors.get(result.region_id);
    if (!anchor || anchor.anchor_membership_sha256 !== result.anchor_membership_sha256) fail(`${result.region_id}: evidence-to-anchor mismatch.`);
    const sr = srState(result, evidence.metrics, policy), rr = rrState(result, evidence.metrics, policy), fr = frState(result, evidence.metrics, policy);
    return {
      region_id: result.region_id,
      performance_class: result.performance_class,
      anchor_cells: result.rr.cell_count,
      sr,
      rr,
      fr,
      boundary_conditioning: boundaryConditioning(bundle, anchor, contexts),
      lineage: {
        p1_ancestor_cells: anchor.lineage_ancestry[0].cell_count,
        supported_rungs_survived: anchor.lineage_ancestry.length,
        terminal_anchor_cells: anchor.cell_count,
        terminal_status: anchor.terminal_status
      },
      profile: profileFor(sr, rr, fr)
    };
  });
  return {
    calibration_case: input.calibration_case,
    evidence_sha256: sha256(evidenceBytes),
    anchor_artifact_sha256: sha256(anchorBytes),
    anchor_count: results.length,
    summary: {
      sr_bands: countBy(results, result => result.sr.band),
      rr_bands: countBy(results, result => result.rr.band),
      fr_bands: countBy(results, result => result.fr.band),
      profiles: countBy(results, 'profile')
    },
    results
  };
}

function buildArtifact() {
  const policyBytes = fs.readFileSync(POLICY_PATH), policy = JSON.parse(policyBytes);
  if (!policy.frozen || policy.authoritative !== false || policy.policy_origin !== 'post_result_exploratory') fail('Frozen exploratory Step-5 policy is required.');
  const cases = INPUTS.map(input => adjudicateCase(input, policy));
  return {
    schema_version: 1,
    artifact_type: 'step5_joint_calibration_and_adjudication',
    policy_origin: 'post_result_exploratory',
    authoritative: false,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    policy_sha256: sha256(policyBytes),
    calibration_rule: 'each surface is one equal calibration case; anchor counts are descriptive and not statistical weights',
    total_anchors: cases.reduce((sum, item) => sum + item.anchor_count, 0),
    cases
  };
}

function main() {
  const artifact = buildArtifact();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, policy_sha256: artifact.policy_sha256, total_anchors: artifact.total_anchors, cases: artifact.cases.map(item => ({ calibration_case: item.calibration_case, anchor_count: item.anchor_count, summary: item.summary })) }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { srState, rrState, frState, boundaryIndex, boundaryConditioning, profileFor, adjudicateCase, buildArtifact };
