'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync } = require(require.resolve('fflate', { paths: [path.join(__dirname, '..', 'node')] }));
const Frozen = require('../node/frozen-anchor-v001.cjs');
const VolSpike = require('../node/volspike-calibration-v001.cjs');

const ROOT = path.join(__dirname, '..');
const REGISTRY = path.join(ROOT, 'registry');
const ORIGINAL = '/private/tmp/volspike_surface_acceptance_v2_repeat/nxm_56k_20260911_01.surface.zip';
const ANCHORS = path.join(ROOT, 'policies', 'exploratory', 'volspike-step4-frozen-anchors-v001.json');
const EVIDENCE = path.join(ROOT, 'policies', 'exploratory', 'volspike-step5-anchor-evidence-v001.json');
const SCHEMA = path.join(ROOT, 'policies', 'exploratory', 'step5-robustness-evidence-schema-v001.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const bundle = VolSpike.loadVolSpike(REGISTRY);
const manifest = JSON.parse(fs.readFileSync(VolSpike.MANIFEST_PATH, 'utf8'));
assert.equal(bundle.source.rows * bundle.source.cols, 56000);
assert.equal(bundle.graph.N, 41195);
assert.equal(bundle.removed.length, 14805);
assert.equal(bundle.retained.length, 41195);
assert.equal(bundle.tail.length, 35);
assert.equal(bundle.cleanedDomainIdentity, '3702fce810703a9e885ea53c9b8b101c56fe6355b5dc46744698d612daf65228');
assert.equal(bundle.retainedKeysSha256, '03e404dcdc2454e4ac8d696139bac4836f90fb3a7cb833ac8ea507309e42080b');
assert.equal(bundle.scopesArtifact.scope_list_sha256, 'ab3565375414b05626b62245f0ef19db01cf35809e58f57b160f78fc80150e50');
assert.equal(bundle.scopesArtifact.scopes.length, 91);
assert.equal(new Set(bundle.keysByIndex).size, 41195);
assert.ok(bundle.surface.supportFields.trades instanceof Int32Array);

const physicalRecord = bundle.packageData.record;
const physical = unzipSync(fs.readFileSync(path.join(REGISTRY, physicalRecord.path)));
const original = unzipSync(fs.readFileSync(ORIGINAL));
assert.equal(sha256(physical['surface.semantic.csv']), sha256(original['surface.semantic.csv']));
assert.equal(sha256(physical['surface.semantic.csv']), VolSpike.SEMANTIC_CSV_SHA256);

assert.throws(() => VolSpike.assertUniqueRetainedKeys(bundle.keysByIndex.slice(1)), /duplicate or missing/);
const duplicate = [...bundle.keysByIndex]; duplicate[0] = duplicate[1];
assert.throws(() => VolSpike.assertUniqueRetainedKeys(duplicate), /duplicate or missing/);
for (const patch of [
  { storage_surface: { ...manifest.storage_surface, package_sha256: '0'.repeat(64) } },
  { outcome_summary: { ...manifest.outcome_summary, removed_cells: 14804 } },
  { outcome_summary: { ...manifest.outcome_summary, retained_cells: 41196 } },
  { outcome_summary: { ...manifest.outcome_summary, known_35_cell_tail_removed: 1 } },
  { prune_scopes: { ...manifest.prune_scopes, scope_list_sha256: '0'.repeat(64) } },
  { cleaned_domain_identity: { ...manifest.cleaned_domain_identity, retained_analysis_keys_sha256: '0'.repeat(64) } },
  { surface_policy: { ...manifest.surface_policy, sha256_exact_file_bytes: '0'.repeat(64) } },
  { graph_contract: { ...manifest.graph_contract, topology_engine_version: 'wrong' } }
]) assert.throws(() => VolSpike.verifyManifest(bundle, { ...manifest, ...patch }), /mismatch|invariant/);

for (let cell = 0; cell < bundle.graph.N; cell++) for (let edge = bundle.graph.offsets[cell]; edge < bundle.graph.offsets[cell + 1]; edge++) {
  const neighbor = bundle.graph.neighbors[edge];
  const adjacent = bundle.graph.info.ordered.some(parameterIndex => {
    const id = bundle.graph.info.defs[parameterIndex].id;
    const a = bundle.surface.semanticParameterIndices[id][cell], b = bundle.surface.semanticParameterIndices[id][neighbor];
    return a >= 0 && b >= 0 && Math.abs(a - b) === 1;
  });
  assert.equal(adjacent, true, 'filtered graph must not bridge a removed ordered level');
}

const anchorBytes = fs.readFileSync(ANCHORS), anchors = JSON.parse(anchorBytes);
const evidence = JSON.parse(fs.readFileSync(EVIDENCE, 'utf8'));
assert.equal(anchors.bindings.surface_id, VolSpike.CLEANED_SURFACE_ID);
assert.equal(anchors.bindings.storage_surface_id, VolSpike.PHYSICAL_SURFACE_ID);
assert.equal(anchors.bindings.cleaned_domain_identity, bundle.cleanedDomainIdentity);
assert.equal(anchors.anchors.length, 71);
assert.equal(anchors.anchors.reduce((sum, anchor) => sum + anchor.cell_count, 0), 1763);
assert.deepEqual(anchors.anchors.reduce((counts, anchor) => { counts[anchor.performance_class] = (counts[anchor.performance_class] || 0) + 1; return counts; }, {}), { P1: 29, P2: 13, P5: 6, P4: 13, P3: 8, P6: 2 });
assert.equal(evidence.anchor_artifact_sha256, sha256(anchorBytes));
assert.equal(evidence.evidence_schema_sha256, sha256(fs.readFileSync(SCHEMA)));
assert.equal(evidence.results.length, anchors.anchors.length);
for (const anchor of anchors.anchors) {
  assert.equal(anchor.anchor_membership_sha256, Frozen.membershipHash(anchor.analysis_keys));
  const result = evidence.results.find(item => item.region_id === anchor.region_id);
  assert.equal(result.anchor_membership_sha256, anchor.anchor_membership_sha256);
  assert.equal(result.rr.cell_count, anchor.cell_count);
  assert.ok(result.sr_decomposition.r_per_trade.neighbor_coverage.count > 0);
}

console.log('PASS VolSpike typed package, exact Step-3 mask, filtered graph, fresh Step-4 anchors, and Step-5 evidence');
