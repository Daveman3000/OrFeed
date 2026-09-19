'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ContextSpans = require('../node/step6-context-spans-v002.cjs');
const Ranking = require('../node/step6-envelope-ranking-v002.cjs');

const ROOT = path.join(__dirname, '..');
const CONTEXT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-context-spans-v002.json');
const RESULT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-ranking-result-v002.json');
const contextArtifact = ContextSpans.verifyArtifact(JSON.parse(fs.readFileSync(CONTEXT_PATH, 'utf8')));
const artifact = Ranking.buildArtifact();
const vb = artifact.cases.find(item => item.calibration_case === 'volume_bands');
const vs = artifact.cases.find(item => item.calibration_case === 'volspike');

assert.equal(contextArtifact.cases.find(item => item.calibration_case === 'volume_bands').cleaned_domain_cells, 311150);
assert.equal(contextArtifact.cases.find(item => item.calibration_case === 'volume_bands').contexts.length, 4);
assert.equal(contextArtifact.cases.find(item => item.calibration_case === 'volspike').cleaned_domain_cells, 41195);
assert.equal(contextArtifact.cases.find(item => item.calibration_case === 'volspike').contexts.length, 229);

assert.equal(artifact.authoritative, false);
assert.equal(artifact.final_step7_shortlist_frozen, false);
assert.equal(vb.eligible_consolidated_candidates, 5);
assert.equal(vb.stability_role_candidates, 0);
assert.equal(vs.eligible_consolidated_candidates, 51);
assert.equal(vs.stability_role_candidates, 5);

assert.equal(vb.rankings.performance_led.top_three_stability.identical_across_weights, true);
assert.equal(vb.rankings.performance_led.top_three_stability.intersection_membership_sha256.length, 3);
assert.equal(vb.rankings.stability_led.top_three_stability.union_membership_sha256.length, 0);
assert.equal(vs.rankings.performance_led.top_three_stability.identical_across_weights, false);
assert.equal(vs.rankings.performance_led.top_three_stability.intersection_membership_sha256.length, 2);
assert.equal(vs.rankings.performance_led.top_three_stability.union_membership_sha256.length, 5);
assert.ok(vs.rankings.performance_led.top_three_stability.pairwise_jaccard.every(item => item.jaccard === 0.5));
assert.equal(vs.rankings.stability_led.top_three_stability.identical_across_weights, true);
assert.equal(vs.rankings.stability_led.top_three_stability.intersection_membership_sha256.length, 3);

for (const calibrationCase of artifact.cases) for (const candidate of calibrationCase.candidates) {
  assert.ok(candidate.performance_score >= 0 && candidate.performance_score <= 1);
  assert.ok(candidate.robustness_score >= 0 && candidate.robustness_score <= 1);
  assert.ok(candidate.components.breadth.score >= 0 && candidate.components.breadth.score <= 1);
  assert.ok(candidate.components.breadth.ordered_span_breadth >= 0 && candidate.components.breadth.ordered_span_breadth <= 1);
}

const allNaEnvelope = { fr: { facets: { a: { evidence_status: 'N/A' } } } };
assert.deepEqual(Ranking.frComponents(allNaEnvelope), { mode: 'ALL_FACETS_NA', applicable_facets: 0, supported_facets: 0, quality: null, availability: null, combined: null, supported_facet_quality: [] });
const unsupportedEnvelope = { fr: { facets: { a: { evidence_status: 'APPLICABLE_UNSUPPORTED' } } } };
assert.deepEqual(Ranking.frComponents(unsupportedEnvelope), { mode: 'APPLICABLE_ZERO_SUPPORTED', applicable_facets: 1, supported_facets: 0, quality: null, availability: 0, combined: null, supported_facet_quality: [] });

assert.deepEqual(JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8')), artifact, 'materialized Step-6 v002 ranking artifact is stale');
console.log('step6-envelope-ranking-v002 tests passed');
