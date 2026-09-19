'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Publisher = require('../node/region-analyzer-publisher-v001.cjs');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'region-analyzer', 'catalog.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const publisherSource = fs.readFileSync(path.join(ROOT, 'node', 'region-analyzer-publisher-v001.cjs'), 'utf8');
for (const forbidden of [/require\(['"]fflate/, /require\(['"].*surface-package-core/, /require\(['"].*semantic-analysis/, /require\(['"].*frozen-anchor/, /reconstructLineageNodes\s*\(/, /resolveSurface\s*\(/, /surface\.semantic\.csv/, /function profileFor/]) assert.ok(!forbidden.test(publisherSource), `normal publisher contains heavyweight or research-recomputation path: ${forbidden}`);
assert.ok(!publisherSource.includes('deep-materialize'), 'normal publisher must not expose deep materialization');
const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const surfaceId = 'volbands_20260918_bandtp_shoulder_winpct_v1';
const version = catalog.surfaces[surfaceId].versions.find(item => item.version_id === `${surfaceId}-region-analyzer-v001`);
assert.ok(version, 'published Region Analyzer catalog entry is missing');

const manifestPath = path.join(ROOT, 'region-analyzer', version.manifest_path);
const bundlePath = path.join(ROOT, 'region-analyzer', version.mask_bundle_path);
const manifestBytes = fs.readFileSync(manifestPath), bundleBytes = fs.readFileSync(bundlePath);
const manifest = JSON.parse(manifestBytes);
assert.equal(sha256(manifestBytes), version.content_sha256);
assert.equal(sha256(bundleBytes), version.mask_bundle_sha256);
assert.equal(manifest.surface.surface_id, surfaceId);
assert.equal(manifest.surface.physical_cells, 311150);
assert.equal(manifest.surface.cleaned_domain_mask.kind, 'ALL_PHYSICAL_CELLS');
assert.equal(manifest.mask_bundle.bit_order, 'LSB_FIRST_WITHIN_BYTE');
assert.equal(manifest.mask_bundle.final_byte_padding, 'ZERO');
assert.equal(manifest.mask_bundle.source_status, 'PREMATERIALIZED_IMMUTABLE_INPUT');
assert.equal(manifest.mask_bundle.regeneration, 'SEPARATE_EXPLICIT_DEEP_MATERIALIZATION_ONLY');

const regions = Object.values(manifest.region_dictionary);
assert.equal(regions.length, 55);
assert.equal(new Set(regions.map(region => region.membership_hash)).size, 55);
assert.deepEqual(regions.map(region => region.membership_hash), [...regions.map(region => region.membership_hash)].sort());
for (const region of regions) {
  const bytes = bundleBytes.subarray(region.mask.offset_bytes, region.mask.offset_bytes + region.mask.length_bytes);
  assert.equal(Publisher.popcount(bytes), region.cell_count);
  assert.equal(Publisher.assertZeroPadding(bytes), true);
}
assert.equal(manifest.stages.stage4.all_unique_lineage_envelopes.length, 55);
assert.equal(Object.keys(manifest.stages.stage5.annotations_by_region_id).length, 55);
assert.equal(Object.values(manifest.stages.stage5.annotations_by_region_id).filter(item => item.evidence_authority === 'DEDICATED_FROZEN_STEP5_TERMINAL_EVIDENCE').length, 7);
assert.equal(Object.values(manifest.stages.stage5.annotations_by_region_id).filter(item => item.evidence_authority === 'STORED_STEP6_TRAJECTORY_NONTERMINAL_EVIDENCE').length, 48);
for (const annotation of Object.values(manifest.stages.stage5.annotations_by_region_id).filter(item => item.evidence_authority === 'STORED_STEP6_TRAJECTORY_NONTERMINAL_EVIDENCE')) {
  assert.equal(annotation.profile, null);
  assert.equal(annotation.profile_status, 'NOT_STORED_IN_SOURCE_TRAJECTORY_ARTIFACT');
}

assert.equal(manifest.stages.stage6.ranking_status, 'calibration');
assert.equal(manifest.stages.stage6.center_weights_frozen, false);
assert.equal(manifest.stages.stage6.shortlist_frozen, false);
assert.deepEqual(manifest.stages.stage6.collections.frozen_shortlist, []);
assert.equal(manifest.stages.stage6.collections.all.length, 5);
assert.equal(manifest.stages.stage6.collections.performance.length, 5);
assert.equal(manifest.stages.stage6.collections.stability.length, 0);
assert.equal(manifest.stages.stage6.calibration.performance.runs.length, 3);
assert.equal(manifest.stages.stage6.calibration.stability.runs.length, 3);
assert.equal(manifest.stages.stage6.collections.top_performance.length, 3);
assert.equal(manifest.stages.stage6.collections.top_stability.length, 0);

const domain = Buffer.from([0b00001111, 0]);
assert.equal(Publisher.assertBitsetSubset(Buffer.from([0b00000101, 0]), domain), true);
assert.throws(() => Publisher.assertBitsetSubset(Buffer.from([0b00010000, 0]), domain), /not a subset/);

const rebuilt = Publisher.validatePublication(Publisher.buildPublication());
assert.equal(rebuilt.manifestSha, version.content_sha256);
assert.equal(rebuilt.maskBundleSha, version.mask_bundle_sha256);
assert.ok(rebuilt.manifestBytes.equals(manifestBytes), 'manifest bytes are not deterministic');
assert.ok(rebuilt.maskBundle.equals(bundleBytes), 'mask bundle bytes are not deterministic');
console.log('region-analyzer-publisher-v001 tests passed');
