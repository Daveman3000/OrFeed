'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { strToU8, zipSync } = require(require.resolve('fflate', { paths: [path.join(__dirname, '..', 'node')] }));
const PackageCore = require('../surface-package-core-v001.js');
const Registry = require('../node/surface-registry-v001.cjs');

function fixtureCsv(offset = 0) {
  const metrics = ['r_per_trade', 'expectancy_per_contract', 'profit_factor', 'romad', 'max_drawdown_r', 'total_r'];
  const rows = ['analysis_key,x,f,' + metrics.join(',')];
  let n = 0;
  for (const f of ['A', 'B']) for (const x of [10, 11, 12]) {
    const base = offset + n++;
    rows.push([`k${offset}-${f}-${x}`, x, f, base / 10, base, 1 + base / 10, base / 20, 10 - base / 10, base * 2].join(','));
  }
  return `${rows.join('\n')}\n`;
}

function fixtureDescriptor(sourceHash = 'fixture-source') {
  return {
    descriptor_schema_version: 1,
    descriptor_version: 'registry-test-v1',
    study_id: 'registry-fixture',
    provenance: { source_sha256: sourceHash, source_row_count: 6 },
    results: { metrics: ['r_per_trade', 'expectancy_per_contract', 'profit_factor', 'romad', 'max_drawdown_r', 'total_r'] },
    parameters: [
      { id: 'x', label: 'Length', type: 'integer', topology_role: 'ordered', source: 'outer', values: [10, 11, 12], active_when: 'always' },
      { id: 'f', label: 'Family', type: 'string', topology_role: 'facet', source: 'inner', values: ['A', 'B'], active_when: 'always' }
    ],
    layout: { x_parameter_order: ['x'], y_parameter_order: ['f'] }
  };
}

function writePackage(filePath, { offset = 0, missing = null } = {}) {
  const entries = {};
  if (missing !== 'csv') entries[Registry.CSV_MEMBER] = strToU8(fixtureCsv(offset));
  if (missing !== 'descriptor') entries[Registry.DESCRIPTOR_MEMBER] = strToU8(JSON.stringify(fixtureDescriptor(`source-${offset}`)));
  fs.writeFileSync(filePath, Buffer.from(zipSync(entries)));
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-registry-v001-'));
try {
  const registryRoot = path.join(temp, 'registry');
  const sourceA = path.join(temp, 'fixture-a.surface.zip');
  const sourceB = path.join(temp, 'fixture-b.surface.zip');
  const malformed = path.join(temp, 'malformed.surface.zip');
  writePackage(sourceA);
  writePackage(sourceB, { offset: 100 });
  writePackage(malformed, { missing: 'descriptor' });

  const registry = Registry.createFilesystemRegistry({ registryRoot });
  const first = registry.registerPackage(sourceA, { surfaceId: 'stable-fixture' });
  assert.equal(first.surface_id, 'stable-fixture');
  assert.equal(first.study_id, 'registry-fixture');
  assert.match(first.sha256, /^[a-f0-9]{64}$/);
  assert.equal(path.isAbsolute(first.path), false);
  assert.ok(first.path.startsWith('packages/'));
  assert.ok(fs.existsSync(path.join(registryRoot, first.path)));

  const persisted = JSON.parse(fs.readFileSync(path.join(registryRoot, Registry.INDEX_FILE), 'utf8'));
  assert.equal(persisted.schema_version, 1);
  assert.deepEqual(persisted.surfaces['stable-fixture'], {
    path: first.path,
    sha256: first.sha256,
    study_id: first.study_id,
    registered_at: first.registered_at
  });

  assert.deepEqual(registry.listSurfaces(), [first]);
  assert.deepEqual(registry.registerPackage(sourceA, { surfaceId: 'stable-fixture' }), first, 'same ID and hash must be idempotent');
  assert.throws(() => registry.registerPackage(sourceB, { surfaceId: 'stable-fixture' }), /refusing different SHA-256/);
  assert.throws(() => registry.resolveSurface('missing-fixture'), /Unknown surface_id/);
  assert.throws(() => registry.registerPackage(malformed, { surfaceId: 'malformed' }), /missing surface_descriptor\.json/);

  const surface = registry.resolveSurface('stable-fixture');
  assert.equal(surface.packageVersion, PackageCore.VERSION, 'registry must delegate canonical construction to SurfacePackageCoreV001');
  assert.equal(surface.rows, 2);
  assert.equal(surface.cols, 3);
  assert.equal(surface.metrics.r_per_trade.length, 6);

  const storedPath = path.join(registryRoot, first.path);
  fs.appendFileSync(storedPath, 'tamper');
  assert.throws(() => Registry.createFilesystemRegistry({ registryRoot }).resolveSurface('stable-fixture'), /SHA-256 mismatch/);

  assert.equal(Registry.resolveRegistryRoot('/cli/root', { SURFACE_ANALYZER_REGISTRY: '/env/root' }), path.resolve('/cli/root'));
  assert.equal(Registry.resolveRegistryRoot(null, { SURFACE_ANALYZER_REGISTRY: '/env/root' }), path.resolve('/env/root'));
  assert.throws(() => Registry.resolveRegistryRoot(null, {}), /Registry root is required/);

  console.log('PASS  filesystem registry persists stable hash-protected surfaces and delegates canonical parsing');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
