'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TRAJECTORY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-trajectory-diagnostic-v001.json');
const POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-selection-v001.json');
const OUTPUT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-selection-result-v001.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };

const SR_RANK = { SENSITIVE: 0, MODERATE: 1, STRONG: 2 };
const RR_RANK = { WEAK: 0, MODERATE: 1, STRONG: 2 };
const FR_RANK = { INSUFFICIENT: 0, ECONOMICALLY_WEAK: 1, MIXED: 2, DIVERGENT_VIABLE: 3, 'N/A': 3, ADEQUATE: 4, STRONG: 5 };

function frDeteriorates(from, to) {
  if (to === 'INSUFFICIENT' && from !== 'INSUFFICIENT') return true;
  if (to === 'ECONOMICALLY_WEAK' && from !== 'ECONOMICALLY_WEAK' && from !== 'INSUFFICIENT') return true;
  return to === 'MIXED' && ['STRONG', 'ADEQUATE', 'DIVERGENT_VIABLE', 'N/A'].includes(from);
}

function performanceVeto(from, to, transition, policy) {
  const rule = policy.performance_led.transition_vetoes, reasons = [];
  if (transition.to_over_from_cell_ratio < rule.minimum_retained_cell_fraction) reasons.push('AREA_COLLAPSE');
  if (to.cell_count < rule.minimum_handoff_cells) reasons.push('MINIMUM_HANDOFF_SIZE');
  if (from.topology.multi_value_ordered_dimensions - to.topology.multi_value_ordered_dimensions > rule.maximum_lost_multi_value_ordered_dimensions) reasons.push('ORDERED_SPAN_COLLAPSE');
  if (from.topology.two_core.fraction - to.topology.two_core.fraction > rule.maximum_two_core_fraction_decrease) reasons.push('TWO_CORE_COLLAPSE');
  if (-transition.sr_minimum_metric_median_delta > rule.maximum_minimum_metric_sr_median_decrease) reasons.push('SR_DETERIORATION');
  if (-transition.rr_minimum_interior_similarity_delta > rule.maximum_minimum_rr_interior_similarity_decrease || -transition.rr_minimum_boundary_worse_fraction_delta > rule.maximum_minimum_rr_boundary_worse_fraction_decrease) reasons.push('RR_DETERIORATION');
  if (frDeteriorates(from.fr.band, to.fr.band)) reasons.push('FR_DETERIORATION');
  return reasons;
}

function performanceSelection(calibrationCase, trajectory, policy) {
  const hashes = trajectory.performance_led.envelope_membership_sha256;
  let selectedIndex = 0, veto = null;
  for (let index = 1; index < hashes.length; index++) {
    const reasons = performanceVeto(calibrationCase.envelopes[hashes[index - 1]], calibrationCase.envelopes[hashes[index]], trajectory.performance_led.transitions[index - 1], policy);
    if (reasons.length) { veto = { transition_index: index - 1, rejected_membership_sha256: hashes[index], reasons }; break; }
    selectedIndex = index;
  }
  return { selectedIndex, selected: calibrationCase.envelopes[hashes[selectedIndex]], veto };
}

function stabilityImprovement(performance, candidate, policy) {
  const rule = policy.stability_led.material_improvement, reasons = [];
  if (SR_RANK[candidate.sr.band] > SR_RANK[performance.sr.band] || candidate.sr.minimum_metric_median - performance.sr.minimum_metric_median >= 0.10) reasons.push('SR_IMPROVEMENT');
  if (RR_RANK[candidate.rr.band] > RR_RANK[performance.rr.band] || candidate.rr.minimum_interior_similarity - performance.rr.minimum_interior_similarity >= 0.15 || candidate.rr.minimum_boundary_worse_fraction - performance.rr.minimum_boundary_worse_fraction >= 0.15) reasons.push('RR_IMPROVEMENT');
  if (FR_RANK[candidate.fr.band] > FR_RANK[performance.fr.band]) reasons.push('FR_IMPROVEMENT');
  if (candidate.topology.multi_value_ordered_dimensions - performance.topology.multi_value_ordered_dimensions >= 2 || candidate.topology.two_core.fraction - performance.topology.two_core.fraction >= 0.15) reasons.push('TOPOLOGY_IMPROVEMENT');
  if (!rule) fail('Missing stability material-improvement contract.');
  return reasons;
}

function stabilitySelection(calibrationCase, trajectory, performance, selectedIndex, policy) {
  const hashes = trajectory.performance_led.envelope_membership_sha256;
  const minimumRung = Number(policy.stability_led.minimum_performance_rung.slice(1));
  const floors = policy.stability_led.candidate_floors;
  const [minimumCells, maximumCells] = policy.stability_led.candidate_size_range;
  for (let index = selectedIndex - 1; index >= 0; index--) {
    const candidate = calibrationCase.envelopes[hashes[index]];
    if (candidate.rung_index < minimumRung) break;
    if (candidate.cell_count < minimumCells || candidate.cell_count > maximumCells) continue;
    if (!floors.sr_bands.includes(candidate.sr.band) || !floors.rr_bands.includes(candidate.rr.band) || !floors.fr_bands.includes(candidate.fr.band)) continue;
    const reasons = stabilityImprovement(performance, candidate, policy);
    if (reasons.length) return { selectedIndex: index, selected: candidate, reasons };
  }
  return null;
}

function splitAudit(calibrationCase) {
  const children = new Map();
  for (const trajectory of calibrationCase.trajectories) for (const transition of trajectory.performance_led.transitions) {
    if (!children.has(transition.from_membership_sha256)) children.set(transition.from_membership_sha256, new Map());
    children.get(transition.from_membership_sha256).set(transition.to_membership_sha256, transition);
  }
  return [...children.entries()].filter(([, values]) => values.size > 1).map(([parentHash, values]) => {
    const parent = calibrationCase.envelopes[parentHash], unique = [...values.values()];
    const childCells = unique.reduce((sum, transition) => sum + calibrationCase.envelopes[transition.to_membership_sha256].cell_count, 0);
    return {
      parent_membership_sha256: parentHash,
      parent_rung: parent.rung,
      parent_cells: parent.cell_count,
      collective_child_cells: childCells,
      collective_retained_fraction: childCells / parent.cell_count,
      children: unique.map(transition => ({
        membership_sha256: transition.to_membership_sha256,
        rung: calibrationCase.envelopes[transition.to_membership_sha256].rung,
        cells: calibrationCase.envelopes[transition.to_membership_sha256].cell_count,
        individual_retained_fraction: transition.to_over_from_cell_ratio
      }))
    };
  });
}

function rescanFlag(envelope) {
  return envelope.distributed_sample.available ? { status: 'NOT_REQUIRED', reason: null } : { status: 'TARGETED_RESCAN_REQUIRED', reason: 'UNDER_RESOLVED_FOR_EXISTING_24_CELL_DISTRIBUTED_SAMPLE' };
}

function breadthTier(envelope, policy) {
  const tier = policy.handoff_size.breadth_tiers.find(item => envelope.cell_count >= item.minimum_cells && envelope.cell_count <= item.maximum_cells);
  return tier || null;
}

function evidenceVector(envelope, policy) {
  const tier = breadthTier(envelope, policy);
  if (!tier) return null;
  return [envelope.rung_index, SR_RANK[envelope.sr.band], RR_RANK[envelope.rr.band], FR_RANK[envelope.fr.band], tier.rank];
}

function dominates(left, right, policy) {
  const a = evidenceVector(left, policy), b = evidenceVector(right, policy);
  if (!a || !b) return false;
  return a.every((value, index) => value >= b[index]) && a.some((value, index) => value > b[index]);
}

function consolidateCandidates(lineages, calibrationCase, policy) {
  const exact = new Map();
  for (const lineage of lineages) for (const selection of lineage.provisional_selections) {
    if (selection.handoff_status !== 'ELIGIBLE') continue;
    if (!exact.has(selection.membership_sha256)) exact.set(selection.membership_sha256, {
      membership_sha256: selection.membership_sha256,
      rung: selection.rung,
      cell_count: selection.cell_count,
      breadth_tier: selection.breadth_tier,
      roles: new Set(),
      descendant_terminal_regions: new Set(),
      rescan_flag: selection.rescan_flag
    });
    const item = exact.get(selection.membership_sha256);
    item.roles.add(selection.role);
    item.descendant_terminal_regions.add(lineage.terminal_region_id);
  }
  const candidates = [...exact.values()];
  const audit = candidates.map(candidate => {
    const envelope = calibrationCase.envelopes[candidate.membership_sha256];
    const dominators = candidates.filter(other => other !== candidate && dominates(calibrationCase.envelopes[other.membership_sha256], envelope, policy)).map(other => other.membership_sha256).sort();
    return {
      membership_sha256: candidate.membership_sha256,
      evidence_vector: evidenceVector(envelope, policy),
      status: dominators.length ? 'DOMINATED' : 'SELECTED',
      dominating_membership_sha256: dominators
    };
  });
  const selectedHashes = new Set(audit.filter(item => item.status === 'SELECTED').map(item => item.membership_sha256));
  const normalize = item => ({ ...item, roles: [...item.roles].sort(), descendant_terminal_regions: [...item.descendant_terminal_regions].sort() });
  return {
    exact_membership_candidates: candidates.map(normalize),
    frontier_audit: audit,
    selected: candidates.filter(item => selectedHashes.has(item.membership_sha256)).map(normalize)
  };
}

function selectCase(calibrationCase, policy) {
  const lineages = calibrationCase.trajectories.map(trajectory => {
    const performance = performanceSelection(calibrationCase, trajectory, policy);
    const stability = stabilitySelection(calibrationCase, trajectory, performance.selected, performance.selectedIndex, policy);
    const performanceTier = breadthTier(performance.selected, policy);
    const selections = [{ role: 'PERFORMANCE_LED', membership_sha256: performance.selected.membership_sha256, rung: performance.selected.rung, cell_count: performance.selected.cell_count, breadth_tier: performanceTier?.id || null, handoff_status: performanceTier ? 'ELIGIBLE' : performance.selected.cell_count < policy.handoff_size.minimum_cells ? 'UNDER_RESOLVED' : 'OVER_BROAD', rescan_flag: rescanFlag(performance.selected) }];
    if (stability && stability.selected.membership_sha256 !== performance.selected.membership_sha256) {
      const stabilityTier = breadthTier(stability.selected, policy);
      selections.push({ role: 'STABILITY_LED', membership_sha256: stability.selected.membership_sha256, rung: stability.selected.rung, cell_count: stability.selected.cell_count, breadth_tier: stabilityTier.id, handoff_status: 'ELIGIBLE', reasons: stability.reasons, rescan_flag: rescanFlag(stability.selected) });
    }
    return { terminal_region_id: trajectory.terminal_region_id, terminal_performance_class: trajectory.terminal_performance_class, performance_stop_veto: performance.veto, provisional_selections: selections };
  });
  const consolidated = consolidateCandidates(lineages, calibrationCase, policy);
  return {
    calibration_case: calibrationCase.calibration_case,
    terminal_lineages: lineages.length,
    lineages,
    exact_membership_candidates: consolidated.exact_membership_candidates,
    consolidation_audit: consolidated.frontier_audit,
    consolidated_selected_envelopes: consolidated.selected,
    under_resolved_lineages: lineages.filter(lineage => lineage.provisional_selections[0].handoff_status === 'UNDER_RESOLVED').map(lineage => lineage.terminal_region_id).sort(),
    over_broad_lineages: lineages.filter(lineage => lineage.provisional_selections[0].handoff_status === 'OVER_BROAD').map(lineage => lineage.terminal_region_id).sort(),
    split_audit: splitAudit(calibrationCase)
  };
}

function buildArtifact() {
  const trajectoryBytes = fs.readFileSync(TRAJECTORY_PATH), trajectory = JSON.parse(trajectoryBytes);
  const policyBytes = fs.readFileSync(POLICY_PATH), policy = JSON.parse(policyBytes);
  if (sha256(trajectoryBytes) !== policy.source_binding.artifact_sha256) fail('Step-6 trajectory artifact identity mismatch.');
  if (trajectory.total_terminal_structures !== policy.source_binding.required_terminal_structures || trajectory.total_unique_envelopes !== policy.source_binding.required_unique_envelopes) fail('Step-6 trajectory coverage mismatch.');
  if (!policy.frozen || policy.authoritative !== false || policy.scope.surface_specific_exceptions !== false) fail('Frozen global exploratory Step-6 policy is required.');
  const cases = trajectory.cases.map(calibrationCase => selectCase(calibrationCase, policy));
  return {
    schema_version: 1,
    artifact_type: 'step6_selected_lineage_envelopes',
    policy_origin: 'post_result_exploratory',
    authoritative: false,
    source_trajectory_sha256: sha256(trajectoryBytes),
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    policy_sha256: sha256(policyBytes),
    exact_cell_selection_performed: false,
    cases
  };
}

function main() {
  const artifact = buildArtifact();
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, policy_sha256: artifact.policy_sha256, cases: artifact.cases.map(item => ({ calibration_case: item.calibration_case, lineages: item.terminal_lineages, consolidated_envelopes: item.consolidated_selected_envelopes.length, under_resolved_lineages_requiring_targeted_rescan: item.under_resolved_lineages.length, splits: item.split_audit.length })) }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { frDeteriorates, performanceVeto, performanceSelection, stabilityImprovement, stabilitySelection, breadthTier, evidenceVector, dominates, consolidateCandidates, splitAudit, rescanFlag, selectCase, buildArtifact };
