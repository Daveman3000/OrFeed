'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Selection = require('../node/step6-envelope-selection-v001.cjs');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-selection-result-v001.json');
const artifact = Selection.buildArtifact();
const vb = artifact.cases.find(item => item.calibration_case === 'volume_bands');
const vs = artifact.cases.find(item => item.calibration_case === 'volspike');

assert.equal(artifact.exact_cell_selection_performed, false);
assert.equal(vb.terminal_lineages, 7);
assert.equal(vs.terminal_lineages, 71);
assert.ok(vb.lineages.every(lineage => lineage.provisional_selections.length <= 2));
assert.ok(vs.lineages.every(lineage => lineage.provisional_selections.length <= 2));

assert.deepEqual(vb.lineages.map(lineage => lineage.provisional_selections[0].rung).sort(), ['P10', 'P12', 'P13', 'P13', 'P15', 'P15', 'P8'].sort());
assert.equal(vb.split_audit.length, 2);
assert.deepEqual(vb.split_audit.map(split => Number(split.collective_retained_fraction.toFixed(6))).sort((a, b) => a - b), [Number((108 / 357).toFixed(6)), Number((799 / 1502).toFixed(6))]);
assert.equal(vs.split_audit.length, 0);

assert.equal(vs.lineages.filter(lineage => lineage.provisional_selections.length === 2).length, 2);
assert.equal(vs.lineages.filter(lineage => lineage.performance_stop_veto).length, 30);
assert.equal(vs.lineages.filter(lineage => lineage.performance_stop_veto?.reasons.includes('MINIMUM_HANDOFF_SIZE')).length, 24);
assert.equal(vs.under_resolved_lineages.length, 22);
assert.equal(vb.under_resolved_lineages.length, 0);
assert.equal(vb.over_broad_lineages.length, 0);
assert.equal(vs.over_broad_lineages.length, 0);

assert.equal(vb.exact_membership_candidates.length, 5);
assert.equal(vb.consolidated_selected_envelopes.length, 1);
assert.equal(vb.consolidated_selected_envelopes[0].rung, 'P15');
assert.equal(vb.consolidated_selected_envelopes[0].cell_count, 357);
assert.equal(vb.consolidated_selected_envelopes[0].breadth_tier, 'HEALTHY');

assert.equal(vs.exact_membership_candidates.length, 51);
assert.equal(vs.consolidated_selected_envelopes.length, 9);
assert.deepEqual(vs.consolidated_selected_envelopes.map(envelope => envelope.cell_count).sort((a, b) => a - b), [26, 32, 40, 48, 51, 57, 63, 67, 115]);
assert.deepEqual(vs.consolidated_selected_envelopes.map(envelope => envelope.roles.join('+')).sort(), ['PERFORMANCE_LED', 'PERFORMANCE_LED', 'PERFORMANCE_LED', 'PERFORMANCE_LED', 'PERFORMANCE_LED', 'PERFORMANCE_LED', 'PERFORMANCE_LED', 'STABILITY_LED', 'STABILITY_LED'].sort());
assert.ok([...vb.consolidation_audit, ...vs.consolidation_audit].every(item => ['SELECTED', 'DOMINATED'].includes(item.status)));
assert.ok([...vb.consolidated_selected_envelopes, ...vs.consolidated_selected_envelopes].every(envelope => envelope.cell_count >= 24 && envelope.cell_count <= 2000));

assert.deepEqual(JSON.parse(fs.readFileSync(OUTPUT, 'utf8')), artifact, 'materialized Step-6 selection artifact is stale');
console.log('step6-envelope-selection-v001 tests passed');
