'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const V004 = require('../node/step6-ranking-calibration-v004.cjs');

const ROOT = path.join(__dirname, '..');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = relative => fs.readFileSync(path.join(ROOT, relative));
const json = relative => JSON.parse(read(relative));

const V003_IDENTITIES = {
  'node/step6-envelope-calibration-v003.cjs': 'e142bd8ab10c5e445069577827bba2de91130d24016ab46b421ebf50b2e78d42',
  'node/step6-performance-distribution-companion-v003.cjs': '318f3310e98389d9bf7be0d36559cbd51803bbbe1b726d1e020c7b2981b990c6',
  'tests/step6-envelope-calibration-v003.test.cjs': '878306242d7196c68526c42657cbe39a9e660e82818328c57c11c12b5235654d',
  'policies/exploratory/step6-envelope-calibration-v003.json': '0cc887b3476eb83f2203c967f3e6a59a36ff7feb18630675ed75cfc8cea44ec9',
  'policies/exploratory/step6-envelope-calibration-result-v003.json': '752ecfacbef6a0a0d90b639b1811345ebc56190b657d2d296c6e979065192936',
  'policies/exploratory/step6-performance-distribution-companion-v003.json': '2ce6572604b023f65a773c84407309de929c57a10cc705b5c15400bc5a0c0587',
  'policies/exploratory/volspike-step4-frozen-anchors-v002.json': '9f6761613a3076d15ac2c835ea151b949567eb4a1fe8c2194ebce90ea5749401',
  'region-analyzer/bundles/df41fe4059da58d8523cd0520270739f13a2ed8513a4b9b2a2db61a90aab2ae8.masks.bin': 'df41fe4059da58d8523cd0520270739f13a2ed8513a4b9b2a2db61a90aab2ae8'
};

for (const [relative, expected] of Object.entries(V003_IDENTITIES)) assert.equal(sha256(read(relative)), expected, `${relative} changed`);

const artifact = V004.buildArtifact();
const materialized = json('policies/exploratory/step6-ranking-calibration-result-v004.json');
const v003 = json('policies/exploratory/step6-envelope-calibration-result-v003.json');
assert.deepEqual(artifact, materialized, 'materialized v004 result is stale');
assert.equal(artifact.authoritative, false);
assert.equal(artifact.v004_policy_frozen, false);
assert.equal(artifact.step7_handoff_frozen, false);

for (const calibrationCase of artifact.cases) {
  const sourceCase = v003.cases.find(item => item.calibration_case === calibrationCase.calibration_case);
  assert.ok(sourceCase);
  for (const grid of calibrationCase.grids) {
    const sourceGrid = sourceCase.grids.find(item => item.grid_id === grid.grid_id);
    assert.ok(sourceGrid);
    for (const role of ['performance_led', 'stability_led']) {
      const result = grid.roles[role], source = sourceGrid.roles[role];
      assert.deepEqual(result.candidate_membership_sha256_in_v003_order, source.exact_membership_candidates.map(item => item.membership_sha256));
      assert.equal(result.candidate_count, source.exact_membership_candidates.length);
      assert.equal(result.breadth_ranking_weight, 0);
      assert.equal(result.ranking_runs.length, 3);
      for (const run of result.ranking_runs) for (const ranked of run.ranking) {
        assert.equal(ranked.components.weights.breadth, 0);
        assert.equal(ranked.score, ranked.components.weights.performance * ranked.components.performance_score + ranked.components.weights.stability * ranked.components.stability_score);
      }
    }
  }
}

const vb = artifact.cases.find(item => item.calibration_case === 'volume_bands');
const vs = artifact.cases.find(item => item.calibration_case === 'volspike');
assert.deepEqual(vb.grids.map(grid => [grid.grid_id, grid.roles.performance_led.candidate_count, grid.roles.stability_led.candidate_count]), [['loose', 6, 4], ['center', 4, 4], ['strict', 4, 4]]);
assert.deepEqual(vs.grids.map(grid => [grid.grid_id, grid.roles.performance_led.candidate_count, grid.roles.stability_led.candidate_count]), [['loose', 69, 4], ['center', 30, 4], ['strict', 27, 4]]);
console.log('step6-ranking-calibration-v004 tests passed');
