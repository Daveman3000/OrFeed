'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-calibration-v003.json');
const TRAJECTORY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-trajectory-diagnostic-v001.json');
const CONTEXT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-context-spans-v002.json');
const COMPANION_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-performance-distribution-companion-v003.json');
const V002_RESULT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-ranking-result-v002.json');
const VB_ANCHORS_PATH = path.join(ROOT, 'policies', 'exploratory', 'volume-bands-step4-frozen-anchors-v001.json');
const VS_ANCHORS_PATH = path.join(ROOT, 'policies', 'exploratory', 'volspike-step4-frozen-anchors-v002.json');
const VB_MANIFEST_PATH = path.join(ROOT, 'region-analyzer', 'versions', '53fba86a6c4be0c8c079652554e9f9e63e2bdd6d3179bc485991276c46580aeb.manifest.json');
const OUTPUT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-calibration-result-v003.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const clamp = value => Math.max(0, Math.min(1, value));
const compareText = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const BAND = { SENSITIVE: 0, WEAK: 0, MODERATE: 1, STRONG: 2, INSUFFICIENT: -1 };

function readBound(pathname, expected, label) {
  const bytes = fs.readFileSync(pathname);
  if (expected && sha256(bytes) !== expected) fail(`${label} exact-byte identity mismatch.`);
  return { bytes, value: JSON.parse(bytes) };
}

function orderedSpan(envelope, context) {
  const dimensions = [];
  for (const [id, full] of Object.entries(context.ordered_dimensions)) {
    if (!full.applicable || full.singleton || !(full.full_cleaned_context_index_span > 0)) continue;
    const observed = envelope.topology.ordered_span[id];
    const span = observed && Number.isFinite(observed.min_index) && Number.isFinite(observed.max_index)
      ? Math.max(0, observed.max_index - observed.min_index) : 0;
    dimensions.push({
      id,
      ratio: clamp(span / full.full_cleaned_context_index_span),
      touches_min: Boolean(observed && observed.min_index === full.full_cleaned_domain_min_index),
      touches_max: Boolean(observed && observed.max_index === full.full_cleaned_domain_max_index),
      boundary_conditioned: Boolean(observed && (observed.min_index === full.full_cleaned_domain_min_index || observed.max_index === full.full_cleaned_domain_max_index))
    });
  }
  if (!dimensions.length) fail(`${envelope.context_id}: no applicable ordered-span denominator.`);
  return { value: dimensions.reduce((sum, item) => sum + item.ratio, 0) / dimensions.length, dimensions };
}

function performanceAxis(envelope, policy, companion) {
  const config = policy.axes.performance;
  const raw = {}, depths = [];
  for (const metric of config.metrics) {
    const zone = envelope.distributed_sample?.metrics?.[metric]?.zone;
    const supplemental = companion?.metrics?.[metric];
    const q25 = zone?.q1 ?? supplemental?.q25;
    const median = zone?.median ?? supplemental?.median;
    if (!Number.isFinite(q25) || !Number.isFinite(median)) fail(`${envelope.membership_sha256}: missing ${metric} Q25/median.`);
    const continuous = value => clamp(1 + (value - config.p1[metric]) / config.rung_step[metric], 1, config.maximum_rung) / config.maximum_rung;
    raw[metric] = { q25, median, source: zone ? 'trajectory_artifact' : 'v003_companion', q25_continuous_rung: continuous(q25), median_continuous_rung: continuous(median) };
    depths.push(config.regional_depth_quantile_weights.q1 * raw[metric].q25_continuous_rung + config.regional_depth_quantile_weights.median * raw[metric].median_continuous_rung);
  }
  const rungScore = clamp(envelope.rung_index / config.maximum_rung);
  const regionalDepth = depths.reduce((sum, value) => sum + value, 0) / depths.length;
  return { score: config.rung_weight * rungScore + config.regional_depth_weight * regionalDepth, rung_score: rungScore, regional_depth: regionalDepth, raw_metrics: raw };
}

function frAxis(envelope) {
  const facets = Object.entries(envelope.fr.facets || {}).map(([id, value]) => ({ id, ...value }));
  const applicable = facets.filter(item => item.evidence_status !== 'N/A');
  const supported = applicable.filter(item => item.evidence_status === 'APPLICABLE_SUPPORTED');
  const weak = supported.filter(item => item.peer_economics?.band === 'WEAK');
  const quality = supported.length ? supported.reduce((sum, item) => sum + 0.5 * clamp(item.structural_similarity.value) + 0.5 * clamp(item.peer_economics.value), 0) / supported.length : null;
  return {
    overall_band: envelope.fr.band,
    applicable_facets: applicable.length,
    supported_facets: supported.length,
    unsupported_facets: applicable.length - supported.length,
    quality,
    availability: applicable.length ? supported.length / applicable.length : null,
    economically_weak_supported_facets: weak.map(item => item.id),
    evidence_mode: !applicable.length ? 'ALL_FACETS_NA' : supported.length ? 'SUPPORTED_APPLICABLE' : 'APPLICABLE_ZERO_SUPPORTED',
    facets
  };
}

function stabilityAxis(envelope, policy) {
  const sr = policy.axes.stability.sr_mapping[envelope.sr.band];
  const rr = policy.axes.stability.rr_mapping[envelope.rr.band];
  if (!Number.isFinite(sr) || !Number.isFinite(rr)) return { score: null, evidence_coverage: 0, sr_score: sr ?? null, rr_score: rr ?? null, fr: frAxis(envelope), tier: null };
  const fr = frAxis(envelope);
  let score, coverage;
  if (fr.supported_facets) { score = 0.4 * sr + 0.4 * rr + 0.2 * fr.quality; coverage = 1; }
  else { score = 0.5 * sr + 0.5 * rr; coverage = fr.evidence_mode === 'ALL_FACETS_NA' ? 1 : 0.8; }
  const noWeak = !fr.economically_weak_supported_facets.length;
  let tier = null;
  if (BAND[envelope.sr.band] >= BAND.MODERATE && BAND[envelope.rr.band] >= BAND.MODERATE && noWeak) tier = 'STABLE';
  if (BAND[envelope.sr.band] >= BAND.MODERATE && envelope.rr.band === 'STRONG' && noWeak) tier = 'STRONG';
  if (envelope.sr.band === 'STRONG' && envelope.rr.band === 'STRONG' && noWeak && (!fr.supported_facets || ['STRONG', 'ADEQUATE'].includes(fr.overall_band))) tier = 'VERY_STRONG';
  return { score: clamp(score), evidence_coverage: coverage, sr_score: sr, rr_score: rr, sr_band: envelope.sr.band, rr_band: envelope.rr.band, fr, tier };
}

function breadthAxis(envelope, context, p1Cells, minimumSupport, policy) {
  const span = orderedSpan(envelope, context);
  const p1Retention = envelope.cell_count / p1Cells;
  let sizeSupport;
  if (p1Cells === minimumSupport) sizeSupport = 1;
  else {
    const denominator = Math.log(p1Cells / minimumSupport);
    sizeSupport = denominator > 0 ? clamp(Math.log(envelope.cell_count / minimumSupport) / denominator) : 1;
  }
  const twoCore = clamp(envelope.topology.two_core.fraction);
  const weights = policy.axes.breadth;
  return {
    score: weights.ordered_span_weight * span.value + weights.two_core_weight * twoCore + weights.p1_retention_weight * p1Retention + weights.size_support_weight * sizeSupport,
    ordered_span_breadth: span.value,
    ordered_span_dimensions: span.dimensions,
    two_core_fraction: twoCore,
    p1_retention: p1Retention,
    size_support: sizeSupport
  };
}

function transitionGraph(trajectories, envelopes) {
  const children = new Map();
  for (const trajectory of trajectories) {
    const path = trajectory.performance_led.envelope_membership_sha256;
    for (let index = 1; index < path.length; index++) {
      if (!children.has(path[index - 1])) children.set(path[index - 1], new Set());
      children.get(path[index - 1]).add(path[index]);
    }
  }
  return new Map([...children].map(([parent, set]) => {
    const hashes = [...set].sort(compareText);
    const collective = hashes.reduce((sum, hash) => sum + envelopes[hash].cell_count, 0) / envelopes[parent].cell_count;
    return [parent, { children: hashes, collective_supported_child_retention: collective }];
  }));
}

function componentEligible(axis, minimumRung) {
  return axis.rung_index >= minimumRung
    && BAND[axis.stability.sr_band] >= BAND.MODERATE
    && BAND[axis.stability.rr_band] >= BAND.MODERATE
    && !axis.stability.fr.economically_weak_supported_facets.length;
}

function transitionEvidence(parent, child, graph, grid, role) {
  const family = graph.get(parent.membership_sha256);
  const split = family?.children.length > 1;
  const selectedRetention = child.cell_count / parent.cell_count;
  const collectiveRetention = family?.collective_supported_child_retention ?? selectedRetention;
  const breadthLoss = Math.max(0, parent.breadth.score - child.breadth.score);
  const stabilityLoss = Math.max(0, parent.stability.score - child.stability.score);
  const retentionPass = split ? collectiveRetention >= grid.min_split_collective_retention : selectedRetention >= grid.min_ordinary_child_retention;
  const statePass = child.breadth.score >= grid.absolute_breadth_floor && (role === 'performance_led' ? child.stability.score >= grid.absolute_stability_floor : componentEligible(child, 3));
  const deltaPass = breadthLoss <= grid.max_breadth_loss && stabilityLoss <= grid.max_stability_loss;
  let type = 'ORDINARY_TIGHTENING';
  if (split) type = 'SPLIT';
  else if (!retentionPass) type = 'COLLAPSE';
  else if (!statePass || !deltaPass) type = 'WEAKEN';
  return {
    parent_membership_sha256: parent.membership_sha256,
    child_membership_sha256: child.membership_sha256,
    parent_cells: parent.cell_count,
    child_cells: child.cell_count,
    split_supported_children: family?.children.length || 1,
    collective_supported_child_retention: collectiveRetention,
    selected_child_retention: selectedRetention,
    breadth_loss: breadthLoss,
    stability_loss: stabilityLoss,
    performance_gain: child.performance.score - parent.performance.score,
    raw_metric_deltas: Object.fromEntries(Object.keys(child.performance.raw_metrics).map(metric => [metric, {
      q25: child.performance.raw_metrics[metric].q25 - parent.performance.raw_metrics[metric].q25,
      median: child.performance.raw_metrics[metric].median - parent.performance.raw_metrics[metric].median
    }])),
    retention_pass: retentionPass,
    absolute_state_pass: statePass,
    transition_delta_pass: deltaPass,
    defensible: retentionPass && statePass && deltaPass,
    transition_type: type
  };
}

function selectLineage(path, axes, graph, grid, role) {
  const minimumRung = role === 'stability_led' ? 3 : 1;
  const candidates = path.map(hash => axes[hash]);
  let start = candidates.findIndex(item => item.rung_index >= minimumRung);
  if (start < 0) return { selected: null, reason: 'NO_ELIGIBLE_START_RUNG', transitions: [] };
  const first = candidates[start];
  const startPass = first.breadth.score >= grid.absolute_breadth_floor
    && (role === 'performance_led' ? first.stability.score >= grid.absolute_stability_floor : componentEligible(first, minimumRung));
  if (!startPass) return { selected: null, reason: 'STARTING_STATE_FAILED', starting_membership_sha256: first.membership_sha256, transitions: [] };
  let selected = first;
  const transitions = [];
  for (let index = start + 1; index < candidates.length; index++) {
    const evidence = transitionEvidence(candidates[index - 1], candidates[index], graph, grid, role);
    transitions.push(evidence);
    if (!evidence.defensible) return { selected, reason: 'NEXT_TIGHTENING_NOT_DEFENSIBLE', predecessor: candidates[index - 1], next_tighter: candidates[index], stopping_transition: evidence, transitions };
    selected = candidates[index];
  }
  return { selected, reason: 'TERMINAL_REACHED', predecessor: candidates[Math.max(start, candidates.length - 2)] || null, next_tighter: null, stopping_transition: null, transitions };
}

function rank(candidates, weight, tolerance) {
  const rows = candidates.map(item => ({
    membership_sha256: item.membership_sha256,
    score: weight.performance * item.performance.score + weight.breadth * item.breadth.score + weight.stability * item.stability.score
  })).sort((a, b) => b.score - a.score || compareText(a.membership_sha256, b.membership_sha256));
  let groupScore = null, groupRank = 0;
  return rows.map((item, index) => {
    if (groupScore === null || Math.abs(groupScore - item.score) > tolerance) { groupScore = item.score; groupRank = index + 1; }
    return { ...item, rank: groupRank, shortlisted: groupRank <= 3 };
  });
}

function bitCount(byte) { let value = byte, count = 0; while (value) { value &= value - 1; count++; } return count; }
function overlap(left, right, leftCount, rightCount) {
  let intersection = 0;
  for (let index = 0; index < left.length; index++) intersection += bitCount(left[index] & right[index]);
  const union = leftCount + rightCount - intersection;
  return { intersection_cells: intersection, jaccard: union ? intersection / union : 1, a_in_b_containment: leftCount ? intersection / leftCount : 0, b_in_a_containment: rightCount ? intersection / rightCount : 0 };
}

function maskProvider(calibrationCase, anchorArtifact) {
  if (calibrationCase === 'volume_bands') {
    const manifest = JSON.parse(fs.readFileSync(VB_MANIFEST_PATH));
    const bundlePath = path.resolve(path.dirname(VB_MANIFEST_PATH), manifest.mask_bundle.path);
    const bytes = fs.readFileSync(bundlePath);
    if (sha256(bytes) !== manifest.mask_bundle.sha256) fail('Volume Bands mask bundle mismatch.');
    const records = new Map(Object.values(manifest.region_dictionary).map(item => [item.membership_hash, item.mask]));
    return hash => { const item = records.get(hash); if (!item) fail(`${hash}: Volume Bands mask missing.`); return bytes.subarray(item.offset_bytes, item.offset_bytes + item.length_bytes); };
  }
  const bundle = anchorArtifact.membership_bundle;
  const bytes = fs.readFileSync(path.join(ROOT, '..', bundle.path));
  if (sha256(bytes) !== bundle.sha256) fail('VolSpike v2 mask bundle mismatch.');
  const records = new Map(bundle.regions.map(item => [item.membership_sha256, item]));
  return hash => { const item = records.get(hash); if (!item) fail(`${hash}: VolSpike mask missing.`); return bytes.subarray(item.offset_bytes, item.offset_bytes + item.length_bytes); };
}

function evaluateCase(trajectoryCase, contextCase, anchorArtifact, policy, v002Case, companion) {
  const contextById = new Map(contextCase.contexts.map(item => [item.context_id, item]));
  const minimumByTerminal = new Map(anchorArtifact.anchors.map(anchor => [anchor.region_id, anchor.minimum_component_support]));
  const axes = {};
  for (const trajectory of trajectoryCase.trajectories) {
    const path = trajectory.performance_led.envelope_membership_sha256;
    const p1Cells = trajectoryCase.envelopes[path[0]].cell_count;
    const minimum = minimumByTerminal.get(trajectory.terminal_region_id);
    if (!Number.isInteger(minimum)) fail(`${trajectory.terminal_region_id}: minimum component support missing.`);
    for (const hash of path) {
      if (axes[hash]) continue;
      const envelope = trajectoryCase.envelopes[hash], context = contextById.get(envelope.context_id);
      if (!context) fail(`${envelope.context_id}: context denominator missing.`);
      axes[hash] = {
        membership_sha256: hash,
        context_id: envelope.context_id,
        rung: envelope.rung,
        rung_index: envelope.rung_index,
        cell_count: envelope.cell_count,
        step4_min_component_support: minimum,
        performance: performanceAxis(envelope, policy, companion?.envelopes?.[hash]),
        breadth: breadthAxis(envelope, context, p1Cells, minimum, policy),
        stability: stabilityAxis(envelope, policy),
        tractability_status: 'UNASSESSED'
      };
    }
  }
  const graph = transitionGraph(trajectoryCase.trajectories, trajectoryCase.envelopes);
  const getMask = maskProvider(trajectoryCase.calibration_case, anchorArtifact);
  const grids = policy.stopping_grids.map(grid => {
    const byRole = { performance_led: [], stability_led: [] };
    const lineageResults = trajectoryCase.trajectories.map(trajectory => {
      const path = trajectory.performance_led.envelope_membership_sha256;
      const roles = {};
      for (const role of Object.keys(byRole)) {
        const selection = selectLineage(path, axes, graph, grid, role);
        roles[role] = {
          selected_membership_sha256: selection.selected?.membership_sha256 || null,
          selected_rung: selection.selected?.rung || null,
          selected_cells: selection.selected?.cell_count || null,
          reason: selection.reason,
          predecessor_membership_sha256: selection.predecessor?.membership_sha256 || null,
          next_tighter_membership_sha256: selection.next_tighter?.membership_sha256 || null,
          stopping_transition: selection.stopping_transition ?? null,
          transitions: selection.transitions
        };
        if (selection.selected) byRole[role].push({ terminal_region_id: trajectory.terminal_region_id, ...selection.selected });
      }
      return { terminal_region_id: trajectory.terminal_region_id, path, roles };
    });
    const roles = {};
    for (const [role, selected] of Object.entries(byRole)) {
      const consolidatedMap = new Map();
      for (const item of selected) {
        if (!consolidatedMap.has(item.membership_sha256)) consolidatedMap.set(item.membership_sha256, { ...item, descendant_terminal_regions: [] });
        consolidatedMap.get(item.membership_sha256).descendant_terminal_regions.push(item.terminal_region_id);
      }
      const candidates = [...consolidatedMap.values()].sort((a, b) => compareText(a.membership_sha256, b.membership_sha256));
      const overlaps = [];
      for (let left = 0; left < candidates.length; left++) for (let right = left + 1; right < candidates.length; right++) {
        overlaps.push({ a: candidates[left].membership_sha256, b: candidates[right].membership_sha256, ...overlap(getMask(candidates[left].membership_sha256), getMask(candidates[right].membership_sha256), candidates[left].cell_count, candidates[right].cell_count) });
      }
      const rankingRuns = policy.ranking_weights[role].map(weight => ({ weight_id: weight.id, ranking: rank(candidates, weight, policy.output.numeric_tie_tolerance) }));
      roles[role] = { exact_membership_candidates: candidates, overlaps, ranking_runs: rankingRuns };
    }
    return { grid_id: grid.id, lineages: lineageResults, roles };
  });
  const frequencies = {};
  for (const role of ['performance_led', 'stability_led']) {
    const counts = new Map();
    for (const grid of grids) for (const candidate of grid.roles[role].exact_membership_candidates) counts.set(candidate.membership_sha256, (counts.get(candidate.membership_sha256) || 0) + 1);
    frequencies[role] = [...counts].map(([membership_sha256, selected_grid_count]) => ({ membership_sha256, selected_grid_count, selection_frequency: selected_grid_count / grids.length })).sort((a, b) => b.selection_frequency - a.selection_frequency || compareText(a.membership_sha256, b.membership_sha256));
  }
  const v002Performance = v002Case.rankings.performance_led.top_three_stability;
  const v002Stability = v002Case.rankings.stability_led.top_three_stability;
  return {
    calibration_case: trajectoryCase.calibration_case,
    bindings: { cleaned_domain_identity: contextCase.cleaned_domain_identity, descriptor_sha256: contextCase.descriptor_sha256, topology_engine_version: contextCase.topology_engine_version, topology_sha256: contextCase.topology_sha256, anchor_artifact_sha256: sha256(Buffer.from(`${JSON.stringify(anchorArtifact, null, 2)}\n`)) },
    terminal_lineages: trajectoryCase.trajectories.length,
    unique_envelopes: Object.keys(axes).length,
    envelope_axes: axes,
    grids,
    cross_grid_selection: frequencies,
    v002_comparison: {
      performance_top3_union: v002Performance.union_membership_sha256,
      performance_top3_intersection: v002Performance.intersection_membership_sha256,
      stability_top3_union: v002Stability.union_membership_sha256,
      stability_top3_intersection: v002Stability.intersection_membership_sha256
    }
  };
}

function buildArtifact() {
  const policyBound = readBound(POLICY_PATH, null, 'v003 policy');
  const policy = policyBound.value;
  if (policy.authoritative !== false || policy.frozen !== false || policy.policy_origin !== 'post_result_exploratory') fail('v003 must remain exploratory and unfrozen.');
  const trajectory = readBound(TRAJECTORY_PATH, policy.source_binding.trajectory_artifact_sha256, 'trajectory').value;
  const contexts = readBound(CONTEXT_PATH, policy.source_binding.context_span_artifact_sha256, 'context spans').value;
  const companionBound = readBound(COMPANION_PATH, policy.source_binding.performance_distribution_companion_sha256, 'performance-distribution companion');
  if (companionBound.value.payload_sha256 !== policy.source_binding.performance_distribution_companion_payload_sha256) fail('Performance-distribution companion payload mismatch.');
  const v002 = readBound(V002_RESULT_PATH, policy.source_binding.v002_result_sha256, 'v002 result').value;
  const anchors = {
    volume_bands: readBound(VB_ANCHORS_PATH, policy.source_binding.volume_bands_anchor_sha256, 'Volume Bands anchors').value,
    volspike: readBound(VS_ANCHORS_PATH, policy.source_binding.volspike_anchor_v2_sha256, 'VolSpike v2 anchors').value
  };
  if (trajectory.total_unique_envelopes !== policy.source_binding.required_unique_envelopes || trajectory.total_terminal_structures !== policy.source_binding.required_terminal_lineages) fail('v003 source coverage mismatch.');
  const contextByCase = new Map(contexts.cases.map(item => [item.calibration_case, item]));
  const v002ByCase = new Map(v002.cases.map(item => [item.calibration_case, item]));
  const cases = trajectory.cases.map(item => evaluateCase(item, contextByCase.get(item.calibration_case), anchors[item.calibration_case], policy, v002ByCase.get(item.calibration_case), item.calibration_case === 'volspike' ? companionBound.value : null));
  return {
    schema_version: 3,
    artifact_type: 'step6_three_axis_stopping_calibration',
    policy_origin: 'post_result_exploratory',
    authoritative: false,
    v003_policy_frozen: false,
    step7_handoff_frozen: false,
    source_trajectory_sha256: policy.source_binding.trajectory_artifact_sha256,
    source_context_spans_sha256: policy.source_binding.context_span_artifact_sha256,
    source_performance_distribution_companion_sha256: policy.source_binding.performance_distribution_companion_sha256,
    source_v002_result_sha256: policy.source_binding.v002_result_sha256,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    policy_sha256: sha256(policyBound.bytes),
    run_matrix: { stopping_grids: 3, ranking_weights_per_role: 3, outputs_per_role_per_surface: 9 },
    cases
  };
}

function main() {
  const artifact = buildArtifact();
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_PATH, bytes);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, artifact_sha256: sha256(bytes), policy_sha256: artifact.policy_sha256, cases: artifact.cases.map(item => ({ calibration_case: item.calibration_case, lineages: item.terminal_lineages, envelopes: item.unique_envelopes, grids: item.grids.map(grid => ({ grid_id: grid.grid_id, performance_candidates: grid.roles.performance_led.exact_membership_candidates.length, stability_candidates: grid.roles.stability_led.exact_membership_candidates.length })) })) }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { orderedSpan, performanceAxis, frAxis, stabilityAxis, breadthAxis, transitionGraph, transitionEvidence, selectLineage, rank, overlap, buildArtifact };
