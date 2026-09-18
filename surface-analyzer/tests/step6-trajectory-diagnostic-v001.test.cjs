'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Step6 = require('../node/step6-trajectory-diagnostic-v001.cjs');

const ROOT = path.join(__dirname, '..');
const ARTIFACT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-trajectory-diagnostic-v001.json');
const artifact = Step6.buildArtifact();

assert.equal(artifact.thresholds_frozen, false);
assert.equal(artifact.step6_policy_frozen, false);
assert.equal(artifact.selection_performed, false);
assert.equal(artifact.total_terminal_structures, 78);
assert.equal(artifact.total_unique_envelopes, 228);

const vb = artifact.cases.find(item => item.calibration_case === 'volume_bands');
const vs = artifact.cases.find(item => item.calibration_case === 'volspike');
assert.equal(vb.terminal_structures, 7);
assert.equal(vb.unique_envelopes, 55);
assert.equal(vs.terminal_structures, 71);
assert.equal(vs.unique_envelopes, 173);

for (const calibrationCase of artifact.cases) for (const trajectory of calibrationCase.trajectories) {
  assert.deepEqual(trajectory.stability_led.envelope_membership_sha256, [...trajectory.performance_led.envelope_membership_sha256].reverse());
  assert.equal(trajectory.performance_led.transitions.length, trajectory.performance_led.envelope_membership_sha256.length - 1);
  assert.equal(trajectory.stability_led.transitions.length, trajectory.stability_led.envelope_membership_sha256.length - 1);
}

for (const calibrationCase of artifact.cases) for (const envelope of Object.values(calibrationCase.envelopes)) {
  assert.equal(envelope.distributed_sample.available, envelope.cell_count >= 24);
  if (envelope.distributed_sample.available) {
    assert.equal(envelope.distributed_sample.analysis_keys.length, 24);
    assert.equal(new Set(envelope.distributed_sample.analysis_keys).size, 24);
    assert.equal(envelope.distributed_sample.all_sample_cells_pass_rung, true);
  }
}

assert.deepEqual(JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8')), artifact, 'materialized Step-6 diagnostic artifact is stale');
console.log('step6-trajectory-diagnostic-v001 tests passed');
