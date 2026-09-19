'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const Calibration = require('../node/step6-envelope-calibration-v003.cjs');

const ROOT = path.join(__dirname, '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = relative => fs.readFileSync(path.join(ROOT, relative));
const json = relative => JSON.parse(read(relative));

const V002_IDENTITIES = {
  'node/step6-envelope-ranking-v002.cjs': 'dc11eeb91e17fa3b5e893156d1213c99bbc167ad0bbfcfe9597a06c4ad78af1d',
  'tests/step6-envelope-ranking-v002.test.cjs': 'b1e429a24c7f923d1917ccc79eefc0b253401d12dfad8f8be6d908cc6f0b92b7',
  'policies/exploratory/step6-envelope-ranking-v002.json': 'b65db6d87a259d6d6ace8075f426d15d6efb3a928ef641afdf38ba15c07f2549',
  'policies/exploratory/step6-envelope-ranking-result-v002.json': 'f738c38279874694d9d217e3bbaae2cd8c54313ae342f0acd47bd8288e62c537',
  'node/step6-context-spans-v002.cjs': 'c5adebd1e895dbf3060e6a0e74a22e20a2a112282c42184536bf03d982312e7f',
  'policies/exploratory/step6-context-spans-v002.json': 'fc44a6332f30bd329dfd9a776abe5aeaa59b146c498a82bb16f242379ca0e900',
  'node/step6-envelope-selection-v001.cjs': '1d2478d06c7e9cdfa595a76a7888f3c89ec580661bc4e4534dc75b1caea1614f',
  'policies/exploratory/step6-envelope-selection-v001.json': 'd18e0b682aec89d01dcca54eee52a6d7aba5103d9355ddad012f331327334884',
  'policies/exploratory/step6-envelope-selection-result-v001.json': 'c5560e90e150f459e275d0492757005c6f4c9639c5ce215b7635a6bb0f7fa7cb'
};

test('v002 authorities remain byte-identical', () => {
  for (const [relative, expected] of Object.entries(V002_IDENTITIES)) assert.equal(sha256(read(relative)), expected, relative);
});

test('VolSpike v2 is a compact authoritative membership bundle over all 173 envelopes', () => {
  const artifactBytes = read('policies/exploratory/volspike-step4-frozen-anchors-v002.json');
  const artifact = JSON.parse(artifactBytes);
  assert.equal(sha256(artifactBytes), '9f6761613a3076d15ac2c835ea151b949567eb4a1fe8c2194ebce90ea5749401');
  assert.equal(artifact.schema_version, 2);
  assert.equal(artifact.anchors.length, 71);
  assert.equal(artifact.membership_bundle.regions.length, 173);
  assert.equal(artifact.membership_bundle.bytes, 1218000);
  assert.equal(artifact.membership_bundle.sha256, 'df41fe4059da58d8523cd0520270739f13a2ed8513a4b9b2a2db61a90aab2ae8');
  assert.equal(sha256(read('region-analyzer/bundles/df41fe4059da58d8523cd0520270739f13a2ed8513a4b9b2a2db61a90aab2ae8.masks.bin')), artifact.membership_bundle.sha256);
  assert.deepEqual(artifact.membership_bundle.cleaned_domain_mask, { kind: 'BUNDLE_BITSET', offset_bytes: 0, length_bytes: 7000, cell_count: 41195 });
});

test('v003 companion is minimal, complete, and provenance-bound', () => {
  const artifact = json('policies/exploratory/step6-performance-distribution-companion-v003.json');
  assert.equal(artifact.scope, 'v003_missing_performance_distributions_only');
  assert.equal(artifact.envelope_count, 50);
  assert.deepEqual(artifact.metrics, ['r_per_trade', 'profit_factor', 'romad']);
  assert.equal(Object.keys(artifact.envelopes).length, 50);
  for (const [hash, envelope] of Object.entries(artifact.envelopes)) {
    assert.equal(envelope.membership_sha256, hash);
    for (const metric of artifact.metrics) assert.deepEqual(Object.keys(envelope.metrics[metric]), ['q25', 'median']);
  }
  assert.equal(artifact.source_trajectory_sha256, '5787f702f4730d5a4c43e398207f9ce354ee0b51620d0f9ae6e3e9aec7166ec9');
  assert.equal(artifact.source_anchor_v2_sha256, '9f6761613a3076d15ac2c835ea151b949567eb4a1fe8c2194ebce90ea5749401');
  assert.equal(artifact.source_membership_bundle_sha256, 'df41fe4059da58d8523cd0520270739f13a2ed8513a4b9b2a2db61a90aab2ae8');
});

test('v003 calibration is deterministic and keeps scoring downstream of selection', () => {
  const built = Calibration.buildArtifact();
  const materialized = json('policies/exploratory/step6-envelope-calibration-result-v003.json');
  assert.deepEqual(built, materialized);
  assert.equal(built.authoritative, false);
  assert.equal(built.v003_policy_frozen, false);
  assert.equal(built.step7_handoff_frozen, false);
  assert.deepEqual(built.run_matrix, { stopping_grids: 3, ranking_weights_per_role: 3, outputs_per_role_per_surface: 9 });
  assert.equal(built.cases.reduce((sum, item) => sum + item.unique_envelopes, 0), 228);
  assert.equal(built.cases.reduce((sum, item) => sum + item.terminal_lineages, 0), 78);
  for (const calibrationCase of built.cases) {
    assert.equal(calibrationCase.grids.length, 3);
    for (const grid of calibrationCase.grids) for (const role of ['performance_led', 'stability_led']) {
      const roleResult = grid.roles[role];
      assert.equal(roleResult.ranking_runs.length, 3);
      const membership = roleResult.exact_membership_candidates.map(item => item.membership_sha256).sort();
      for (const run of roleResult.ranking_runs) assert.deepEqual(run.ranking.map(item => item.membership_sha256).sort(), membership);
    }
  }
});

test('transition stopping uses collective retention for splits and selected retention otherwise', () => {
  const parent = { membership_sha256: 'p', cell_count: 100, breadth: { score: 0.8 }, stability: { score: 0.8 } };
  const child = { membership_sha256: 'c', cell_count: 10, breadth: { score: 0.7 }, stability: { score: 0.7 }, performance: { score: 0.6, raw_metrics: { r_per_trade: { q25: 1, median: 1 }, profit_factor: { q25: 2, median: 2 }, romad: { q25: 3, median: 3 } } }, rung_index: 4 };
  parent.performance = { score: 0.5, raw_metrics: { r_per_trade: { q25: 0.8, median: 0.8 }, profit_factor: { q25: 1.8, median: 1.8 }, romad: { q25: 2.8, median: 2.8 } } };
  child.stability = { ...child.stability, sr_band: 'MODERATE', rr_band: 'MODERATE', fr: { economically_weak_supported_facets: [] } };
  const grid = { min_ordinary_child_retention: 0.2, min_split_collective_retention: 0.4, max_breadth_loss: 0.15, max_stability_loss: 0.15, absolute_breadth_floor: 0.3, absolute_stability_floor: 0.45 };
  const splitGraph = new Map([['p', { children: ['c', 'sibling'], collective_supported_child_retention: 0.5 }]]);
  const split = Calibration.transitionEvidence(parent, child, splitGraph, grid, 'performance_led');
  assert.equal(split.transition_type, 'SPLIT');
  assert.equal(split.retention_pass, true);
  const ordinary = Calibration.transitionEvidence(parent, child, new Map(), grid, 'performance_led');
  assert.equal(ordinary.transition_type, 'COLLAPSE');
  assert.equal(ordinary.retention_pass, false);
});
