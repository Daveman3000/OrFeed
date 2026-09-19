'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Publisher = require('../node/region-analyzer-volspike-publisher-v001.cjs');

const ROOT = path.join(__dirname, '..');
const CATALOG = path.join(ROOT, 'region-analyzer', 'catalog.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

const source = fs.readFileSync(path.join(ROOT, 'node', 'region-analyzer-volspike-publisher-v001.cjs'), 'utf8');
for (const forbidden of [/surface\.semantic\.csv/, /reconstructLineageNodes\s*\(/, /resolveSurface\s*\(/, /ensureTopology\s*\(/]) {
  assert.ok(!forbidden.test(source), `VolSpike publisher must not reconstruct research state: ${forbidden}`);
}

const catalog = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
const surfaceId = 'volspike_20260911_step3clean_trades_v1';
const version = catalog.surfaces[surfaceId]?.versions?.find(item => item.version_id === `${surfaceId}-region-analyzer-v001`);
assert.ok(version, 'VolSpike Region Analyzer catalog entry is missing');

const manifestPath = path.join(ROOT, 'region-analyzer', version.manifest_path);
const bundlePath = path.join(ROOT, 'region-analyzer', version.mask_bundle_path);
const manifestBytes = fs.readFileSync(manifestPath);
const bundleBytes = fs.readFileSync(bundlePath);
const manifest = JSON.parse(manifestBytes);

assert.equal(sha256(manifestBytes), version.content_sha256);
assert.equal(sha256(bundleBytes), version.mask_bundle_sha256);
assert.equal(manifest.surface.surface_id, surfaceId);
assert.equal(manifest.surface.physical_cells, 56000);
assert.equal(manifest.surface.cleaned_domain_mask.kind, 'BUNDLE_BITSET');
assert.equal(manifest.surface.cleaned_domain_mask.cell_count, 41195);
assert.equal(manifest.mask_bundle.bytes_per_mask, 7000);
assert.equal(Object.keys(manifest.region_dictionary).length, 173);
assert.equal(Object.keys(manifest.stages.stage5.annotations_by_region_id).length, 71);

const domain = manifest.surface.cleaned_domain_mask;
const domainBytes = bundleBytes.subarray(domain.offset_bytes, domain.offset_bytes + domain.length_bytes);
assert.equal(Publisher.popcount(domainBytes), 41195);
for (const region of Object.values(manifest.region_dictionary)) {
  const bytes = bundleBytes.subarray(region.mask.offset_bytes, region.mask.offset_bytes + region.mask.length_bytes);
  assert.equal(Publisher.popcount(bytes), region.cell_count);
  assert.equal(Publisher.assertBitsetSubset(bytes, domainBytes), true);
}

assert.deepEqual(['strict', 'center', 'loose'].map(id => [
  id,
  manifest.stages.stage6.tolerances[id].modes.performance.candidate_count,
  manifest.stages.stage6.tolerances[id].modes.stability.candidate_count
]), [['strict', 27, 4], ['center', 30, 4], ['loose', 69, 4]]);

for (const tolerance of Object.values(manifest.stages.stage6.tolerances)) for (const mode of Object.values(tolerance.modes)) {
  assert.equal(mode.runs.length, 3);
  for (const run of mode.runs) {
    assert.equal(typeof run.performance_weight, 'number');
    assert.equal(typeof run.stability_weight, 'number');
    assert.ok(Math.abs(run.performance_weight + run.stability_weight - 1) <= 1e-12);
  }
}

const rebuilt = Publisher.validatePublication(Publisher.buildPublication());
assert.equal(rebuilt.manifestSha, version.content_sha256);
assert.equal(rebuilt.maskBundleSha, version.mask_bundle_sha256);
assert.ok(rebuilt.manifestBytes.equals(manifestBytes), 'VolSpike manifest bytes are not deterministic');
assert.ok(rebuilt.maskBundle.equals(bundleBytes), 'VolSpike bundle bytes changed');

console.log('region-analyzer-volspike-publisher-v001 tests passed');
