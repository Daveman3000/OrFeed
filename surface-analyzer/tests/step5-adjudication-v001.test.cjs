'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Step5 = require('../node/step5-adjudication-v001.cjs');

const ROOT = path.join(__dirname, '..');
const ARTIFACT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step5-joint-calibration-v001.json');
const artifact = Step5.buildArtifact();

assert.equal(artifact.total_anchors, 78);
assert.equal(artifact.cases.length, 2);
const vb = artifact.cases.find(item => item.calibration_case === 'volume_bands');
const vs = artifact.cases.find(item => item.calibration_case === 'volspike');
assert.equal(vb.anchor_count, 7);
assert.equal(vs.anchor_count, 71);
assert.deepEqual(vb.summary.sr_bands, { SENSITIVE: 7 });
assert.deepEqual(vb.summary.rr_bands, { STRONG: 7 });
assert.deepEqual(vb.summary.fr_bands, { MIXED: 1, INSUFFICIENT: 3, DIVERGENT_VIABLE: 3 });
assert.deepEqual(vb.summary.profiles, { MIXED_AMBIGUOUS: 1, INSUFFICIENT_EVIDENCE: 3, REGIONALLY_COHERENT_LOCALLY_SENSITIVE: 3 });
assert.deepEqual(vs.summary.sr_bands, { MODERATE: 42, SENSITIVE: 20, STRONG: 9 });
assert.deepEqual(vs.summary.rr_bands, { WEAK: 42, MODERATE: 25, STRONG: 4 });
assert.deepEqual(vs.summary.fr_bands, { ECONOMICALLY_WEAK: 42, ADEQUATE: 15, DIVERGENT_VIABLE: 14 });
assert.deepEqual(vs.summary.profiles, { MIXED_AMBIGUOUS: 57, LOCALLY_SMOOTH_REGIONALLY_WEAK: 14 });

for (const calibrationCase of artifact.cases) for (const result of calibrationCase.results) {
  assert.notEqual(result.sr.band, 'INSUFFICIENT');
  assert.notEqual(result.rr.band, 'INSUFFICIENT');
  assert.ok(result.profile);
  assert.ok(Object.values(result.boundary_conditioning).every(value => value.evidence_status === 'N/A' || typeof value.touches_min === 'boolean'));
}

assert.ok(vb.results.every(result => result.boundary_conditioning.stop_points.pinned_single_value_at_min));
assert.equal(vs.results.some(result => Object.values(result.fr.facets).some(facet => facet.evidence_status === 'APPLICABLE_UNSUPPORTED')), true);
assert.equal(vs.results.some(result => result.profile === 'INSUFFICIENT_EVIDENCE'), false, 'one unsupported facet must not erase other supported FR evidence');

assert.deepEqual(JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8')), artifact, 'materialized Step-5 adjudication artifact is stale');
console.log('step5-adjudication-v001 tests passed');
