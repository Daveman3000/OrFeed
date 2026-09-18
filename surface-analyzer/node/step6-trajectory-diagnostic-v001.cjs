'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Frozen = require('./frozen-anchor-v001.cjs');
const VolSpike = require('./volspike-calibration-v001.cjs');
const Step5 = require('./step5-adjudication-v001.cjs');

const ROOT = path.join(__dirname, '..');
const REGISTRY = path.join(ROOT, 'registry');
const STEP5_POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step5-robustness-adjudication-v001.json');
const OUTPUT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-trajectory-diagnostic-v001.json');
const INPUTS = [
  {
    calibration_case: 'volume_bands',
    anchors_path: path.join(ROOT, 'policies', 'exploratory', 'volume-bands-step4-frozen-anchors-v001.json'),
    load: () => Frozen.loadVolumeBands(REGISTRY)
  },
  {
    calibration_case: 'volspike',
    anchors_path: path.join(ROOT, 'policies', 'exploratory', 'volspike-step4-frozen-anchors-v001.json'),
    load: () => VolSpike.loadVolSpike(REGISTRY)
  }
];

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function summary(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = p => {
    if (!finite.length) return null;
    const x = (finite.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x);
    return lo === hi ? finite[lo] : finite[lo] + (finite[hi] - finite[lo]) * (x - lo);
  };
  return { count: finite.length, missing: values.length - finite.length, min: q(0), q1: q(0.25), median: q(0.5), q3: q(0.75), max: q(1) };
}

function reconstructLineageNodes(bundle, anchorArtifact) {
  const wanted = new Map();
  for (const anchor of anchorArtifact.anchors) for (const node of anchor.lineage_ancestry) {
    const existing = wanted.get(node.membership_sha256);
    if (existing && (existing.rung !== node.rung || existing.cell_count !== node.cell_count)) fail('Conflicting frozen lineage-node identity.');
    wanted.set(node.membership_sha256, { rung: node.rung, cell_count: node.cell_count });
  }
  const found = new Map(), groups = new Map();
  for (let index = 0; index < bundle.graph.N; index++) {
    const context = Frozen.contextFor(bundle.surface, index, bundle.fixed), contextId = Frozen.contextId(context);
    if (!groups.has(contextId)) groups.set(contextId, { context_id: contextId, context, cells: [] });
    groups.get(contextId).cells.push(index);
  }
  const trades = bundle.surface.supportFields.trades;
  for (const group of groups.values()) {
    const eligible = group.cells.filter(index => trades[index] >= 20 && Frozen.METRICS.every(metric => Number.isFinite(bundle.surface.metrics[metric][index])));
    const p1 = eligible.filter(index => Frozen.METRICS.every(metric => bundle.surface.metrics[metric][index] >= Frozen.threshold(1)[metric]));
    const minimum = Math.max(16, Math.min(32, Math.ceil(0.005 * p1.length)));
    let active = Frozen.components(p1, bundle.graph).filter(cells => cells.length >= minimum).map(cells => ({ cells, rung: 1 }));
    while (active.length) {
      const next = [];
      for (const node of active) {
        const keys = Frozen.sortedKeys(node.cells.map(index => bundle.keysByIndex[index])), membership = Frozen.membershipHash(keys);
        if (wanted.has(membership)) {
          const expected = wanted.get(membership);
          if (expected.rung !== `P${node.rung}` || expected.cell_count !== node.cells.length) fail(`${membership}: reconstructed lineage-node mismatch.`);
          found.set(membership, { ...node, analysis_keys: keys, membership_sha256: membership, context_id: group.context_id, context: group.context, minimum_component_support: minimum });
        }
        if (node.rung >= 20) continue;
        const threshold = Frozen.threshold(node.rung + 1);
        const children = Frozen.components(node.cells.filter(index => Frozen.METRICS.every(metric => bundle.surface.metrics[metric][index] >= threshold[metric])), bundle.graph).filter(cells => cells.length >= minimum);
        for (const cells of children) next.push({ cells, rung: node.rung + 1 });
      }
      active = next;
    }
  }
  const missing = [...wanted.keys()].filter(hash => !found.has(hash));
  if (missing.length) fail(`Failed to reconstruct ${missing.length} frozen lineage nodes.`);
  return found;
}

function twoCore(cells, graph) {
  const included = new Set(cells), degree = new Map(), queue = [];
  for (const cell of cells) {
    let value = 0;
    for (let edge = graph.offsets[cell]; edge < graph.offsets[cell + 1]; edge++) if (included.has(graph.neighbors[edge])) value++;
    degree.set(cell, value);
    if (value < 2) queue.push(cell);
  }
  const removed = new Set();
  for (let at = 0; at < queue.length; at++) {
    const cell = queue[at];
    if (removed.has(cell)) continue;
    removed.add(cell);
    for (let edge = graph.offsets[cell]; edge < graph.offsets[cell + 1]; edge++) {
      const neighbor = graph.neighbors[edge];
      if (!included.has(neighbor) || removed.has(neighbor)) continue;
      const next = degree.get(neighbor) - 1;
      degree.set(neighbor, next);
      if (next < 2) queue.push(neighbor);
    }
  }
  const originalDegrees = cells.map(cell => {
    let value = 0;
    for (let edge = graph.offsets[cell]; edge < graph.offsets[cell + 1]; edge++) if (included.has(graph.neighbors[edge])) value++;
    return value;
  });
  return {
    cell_count: cells.length - removed.size,
    fraction: (cells.length - removed.size) / cells.length,
    original_internal_degree: summary(originalDegrees),
    original_leaf_or_isolated_fraction: originalDegrees.filter(value => value <= 1).length / cells.length
  };
}

function distributedSample(bundle, cells, rung, count = 24) {
  if (cells.length < count) return { available: false, requested_cells: count, available_cells: cells.length, reason: 'FEWER_THAN_24_CELLS' };
  const dimensions = bundle.graph.info.ordered.map(parameterIndex => bundle.graph.info.defs[parameterIndex].id).filter(id => cells.some(index => bundle.surface.semanticParameterIndices[id][index] >= 0));
  const bounds = Object.fromEntries(dimensions.map(id => {
    const values = cells.map(index => bundle.surface.semanticParameterIndices[id][index]).filter(value => value >= 0);
    return [id, { min: Math.min(...values), max: Math.max(...values), values: new Set(values).size }];
  }));
  const coordinates = new Map(cells.map(index => [index, dimensions.map(id => {
    const value = bundle.surface.semanticParameterIndices[id][index], bound = bounds[id];
    return value < 0 || bound.max === bound.min ? 0 : (value - bound.min) / (bound.max - bound.min);
  })]));
  const ordered = [...cells].sort((a, b) => Buffer.compare(Buffer.from(bundle.keysByIndex[a], 'utf8'), Buffer.from(bundle.keysByIndex[b], 'utf8')));
  const selected = [ordered[0]], selectedSet = new Set(selected);
  const distance = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0);
  while (selected.length < count) {
    let best = null, bestDistance = -1;
    for (const candidate of ordered) {
      if (selectedSet.has(candidate)) continue;
      const nearest = Math.min(...selected.map(chosen => distance(coordinates.get(candidate), coordinates.get(chosen))));
      if (nearest > bestDistance) { best = candidate; bestDistance = nearest; }
    }
    selected.push(best); selectedSet.add(best);
  }
  const pairDistances = [];
  for (let i = 0; i < selected.length; i++) for (let j = i + 1; j < selected.length; j++) pairDistances.push(distance(coordinates.get(selected[i]), coordinates.get(selected[j])));
  const threshold = Frozen.threshold(rung), metrics = {};
  for (const metric of Frozen.METRICS) {
    const zone = summary(cells.map(index => bundle.surface.metrics[metric][index]));
    const sample = summary(selected.map(index => bundle.surface.metrics[metric][index]));
    const iqr = zone.q3 - zone.q1;
    metrics[metric] = {
      zone,
      sample,
      sample_minus_zone_median: sample.median - zone.median,
      sample_median_delta_in_zone_iqr_units: iqr > 0 ? (sample.median - zone.median) / iqr : null,
      minimum_sample_margin_above_rung: sample.min - threshold[metric]
    };
  }
  return {
    available: true,
    requested_cells: count,
    selection: 'deterministic_parameter_space_farthest_point_no_metric_ranking',
    analysis_keys: selected.map(index => bundle.keysByIndex[index]),
    normalized_l1_pair_distance: summary(pairDistances),
    dimension_coverage: Object.fromEntries(dimensions.map(id => {
      const sampleValues = new Set(selected.map(index => bundle.surface.semanticParameterIndices[id][index]).filter(value => value >= 0)).size;
      return [id, { sample_unique_values: sampleValues, zone_unique_values: bounds[id].values, fraction: sampleValues / bounds[id].values }];
    })),
    metrics,
    per_cell_trades: summary(selected.map(index => bundle.surface.supportFields.trades[index])),
    all_sample_cells_pass_rung: selected.every(index => Frozen.METRICS.every(metric => bundle.surface.metrics[metric][index] >= threshold[metric]))
  };
}

function failureSignals(record) {
  const signals = [];
  if (!record.distributed_sample.available) signals.push('SAMPLE_24_UNAVAILABLE');
  if (record.topology.two_core.cell_count === 0) signals.push('NO_GRAPH_TWO_CORE');
  if (record.topology.multi_value_ordered_dimensions <= 1) signals.push('ONE_OR_FEWER_MULTI_VALUE_ORDERED_DIMENSIONS');
  if (record.rr.mean_depth === 0 && record.rr.max_depth === 0) signals.push('ALL_CELLS_ON_REGION_BOUNDARY');
  if (record.fr.band === 'INSUFFICIENT') signals.push('FR_APPLICABLE_WITHOUT_SUPPORTED_FACET');
  return signals;
}

function transition(from, to) {
  return {
    from_membership_sha256: from.membership_sha256,
    to_membership_sha256: to.membership_sha256,
    to_over_from_cell_ratio: to.cell_count / from.cell_count,
    sr_minimum_metric_median_delta: to.sr.minimum_metric_median - from.sr.minimum_metric_median,
    rr_minimum_interior_similarity_delta: to.rr.minimum_interior_similarity - from.rr.minimum_interior_similarity,
    rr_minimum_boundary_worse_fraction_delta: to.rr.minimum_boundary_worse_fraction - from.rr.minimum_boundary_worse_fraction,
    fr_band_from: from.fr.band,
    fr_band_to: to.fr.band,
    sample_24_from: from.distributed_sample.available,
    sample_24_to: to.distributed_sample.available,
    observed_changes: [
      ...(to.sr.minimum_metric_median < from.sr.minimum_metric_median ? ['SR_MINIMUM_MEDIAN_DECREASED'] : []),
      ...(to.rr.minimum_interior_similarity < from.rr.minimum_interior_similarity ? ['RR_INTERIOR_DECREASED'] : []),
      ...(to.rr.minimum_boundary_worse_fraction < from.rr.minimum_boundary_worse_fraction ? ['RR_BOUNDARY_SEPARATION_DECREASED'] : []),
      ...(from.distributed_sample.available && !to.distributed_sample.available ? ['SAMPLE_24_BECAME_UNAVAILABLE'] : [])
    ]
  };
}

function evaluateCase(input, step5Policy) {
  const anchorBytes = fs.readFileSync(input.anchors_path), anchorArtifact = JSON.parse(anchorBytes), bundle = input.load();
  const nodes = reconstructLineageNodes(bundle, anchorArtifact), caches = { sr: new Map(), fr: new Map() }, records = {};
  for (const [membership, node] of nodes) {
    const anchor = {
      region_id: `ENV-${membership.slice(0, 16)}`,
      context_id: node.context_id,
      context: node.context,
      performance_class: `P${node.rung}`,
      highest_supported_rung: node.rung,
      rr_anchor_rung: node.rung,
      terminal_status: 'DIAGNOSTIC_ENVELOPE',
      right_censored: false,
      cell_count: node.cells.length,
      minimum_component_support: node.minimum_component_support,
      anchor_membership_sha256: membership,
      analysis_keys: node.analysis_keys,
      lineage_ancestry: []
    };
    const evidence = Frozen.evaluateAnchor(bundle, { policy_origin: 'post_result_exploratory', bindings: anchorArtifact.bindings, anchors: [anchor] }, anchor, caches);
    const sr = Step5.srState(evidence, Frozen.METRICS, step5Policy), rr = Step5.rrState(evidence, Frozen.METRICS, step5Policy), fr = Step5.frState(evidence, Frozen.METRICS, step5Policy);
    const spans = Object.values(evidence.rr.ordered_span);
    const record = {
      membership_sha256: membership,
      rung: `P${node.rung}`,
      rung_index: node.rung,
      cell_count: node.cells.length,
      context_id: node.context_id,
      sr,
      rr: { ...rr, boundary_exposure: evidence.rr.boundary_exposure, mean_depth: evidence.rr.mean_depth, max_depth: evidence.rr.max_depth, per_metric: evidence.rr.metrics },
      fr,
      topology: {
        ordered_span: evidence.rr.ordered_span,
        multi_value_ordered_dimensions: spans.filter(span => span.unique_values >= 2).length,
        two_core: twoCore(node.cells, bundle.graph)
      },
      distributed_sample: distributedSample(bundle, node.cells, node.rung)
    };
    record.observed_failure_signals = failureSignals(record);
    records[membership] = record;
  }
  const trajectories = anchorArtifact.anchors.map(anchor => {
    const performance = anchor.lineage_ancestry.map(node => node.membership_sha256);
    const performanceTransitions = performance.slice(1).map((hash, index) => transition(records[performance[index]], records[hash]));
    const stability = [...performance].reverse();
    const stabilityTransitions = stability.slice(1).map((hash, index) => transition(records[stability[index]], records[hash]));
    return {
      terminal_region_id: anchor.region_id,
      terminal_performance_class: anchor.performance_class,
      performance_led: {
        direction: 'tighten_frozen_performance_rungs_P1_to_terminal',
        envelope_membership_sha256: performance,
        transitions: performanceTransitions
      },
      stability_led: {
        direction: 'expand_terminal_to_frozen_predecessor_envelopes_without_selecting_a_stop',
        envelope_membership_sha256: stability,
        transitions: stabilityTransitions
      }
    };
  });
  return {
    calibration_case: input.calibration_case,
    anchor_artifact_sha256: sha256(anchorBytes),
    terminal_structures: anchorArtifact.anchors.length,
    unique_envelopes: Object.keys(records).length,
    envelopes: records,
    trajectories
  };
}

function buildArtifact() {
  const step5PolicyBytes = fs.readFileSync(STEP5_POLICY_PATH), step5Policy = JSON.parse(step5PolicyBytes);
  const cases = INPUTS.map(input => evaluateCase(input, step5Policy));
  return {
    schema_version: 1,
    artifact_type: 'step6_parallel_trajectory_diagnostic',
    policy_origin: 'post_result_exploratory',
    authoritative: false,
    thresholds_frozen: false,
    step6_policy_frozen: false,
    selection_performed: false,
    source_step5_policy_sha256: sha256(step5PolicyBytes),
    mechanics: {
      candidate_envelopes: 'exact frozen Step-4 lineage memberships only',
      performance_led: 'ascending frozen performance rungs',
      stability_led: 'same immutable envelopes traversed from terminal core toward broader predecessors',
      stability_cutoff: null,
      distributed_sample: '24-cell deterministic farthest-point sample in normalized ordered-parameter space; no metric ranking',
      sample_interpretation: 'descriptive representativeness evidence only; no pass/fail threshold',
      topology: 'ordered spans plus induced graph two-core; no minimum breadth chosen'
    },
    total_terminal_structures: cases.reduce((sum, item) => sum + item.terminal_structures, 0),
    total_unique_envelopes: cases.reduce((sum, item) => sum + item.unique_envelopes, 0),
    cases
  };
}

function main() {
  const artifact = buildArtifact();
  writeJson(OUTPUT_PATH, artifact);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, total_terminal_structures: artifact.total_terminal_structures, total_unique_envelopes: artifact.total_unique_envelopes, cases: artifact.cases.map(item => ({ calibration_case: item.calibration_case, terminal_structures: item.terminal_structures, unique_envelopes: item.unique_envelopes })) }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { summary, reconstructLineageNodes, twoCore, distributedSample, failureSignals, transition, evaluateCase, buildArtifact };
