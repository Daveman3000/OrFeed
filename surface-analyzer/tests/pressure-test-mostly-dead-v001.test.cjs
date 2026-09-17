'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { strToU8, zipSync } = require(require.resolve('fflate', { paths: [path.join(__dirname, '..', 'node')] }));
const Registry = require('../node/surface-registry-v001.cjs');
const PressureTest = require('../node/pressure-test-mostly-dead-v001.cjs');

const SCRIPT = path.join(__dirname, '..', 'node', 'pressure-test-mostly-dead-v001.cjs');
const METRICS = ['r_per_trade', 'expectancy_per_contract', 'profit_factor', 'romad', 'max_drawdown_r', 'total_r'];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function metricRow(primary, sane) {
  return sane
    ? [primary, primary * 2, 1 + primary, primary / 2, 5, primary * 3]
    : [-0.1, -0.2, 0.8, -0.1, 8, -0.3];
}

function writeFixture(filePath) {
  const families = ['alive', 'rescue', 'dead'];
  const descriptor = {
    descriptor_schema_version: 1,
    descriptor_version: 'pressure-test-v1',
    study_id: 'pressure-test-fixture',
    provenance: { source_sha256: 'pressure-test-source', source_row_count: families.length * 3 * 400 },
    results: { metrics: METRICS },
    parameters: [
      { id: 'regime', label: 'Regime', type: 'enum', topology_role: 'regime', source: 'outer', values: [1], active_when: 'always' },
      { id: 'family', label: 'Family', type: 'string', topology_role: 'facet', source: 'outer', values: families, active_when: 'always' },
      { id: 'x', label: 'X', type: 'integer', topology_role: 'ordered', source: 'outer', values: [0, 1, 2], active_when: 'always' },
      { id: 'y', label: 'Y', type: 'integer', topology_role: 'ordered', source: 'inner', values: Array.from({ length: 400 }, (_, i) => i), active_when: 'always' }
    ],
    layout: { x_parameter_order: ['x', 'y'], y_parameter_order: ['regime', 'family'] }
  };
  const rows = [`analysis_key,regime,family,x,y,${METRICS.join(',')}`];
  for (const family of families) for (const x of [0, 1, 2]) for (let y = 0; y < 400; y++) {
    let sane = false;
    let primary = -0.1;
    if (family === 'alive' && y < 40) {
      sane = true;
      primary = [0.05, 0.10, 0.20][x];
    } else if (family === 'rescue' && y < 6) {
      sane = true;
      primary = [0.05, 0.10, 0.20][x];
    } else if (family === 'dead' && x === 2 && [0, 100, 200, 300].includes(y)) {
      sane = true;
      primary = 0.20;
    }
    rows.push([`${family}-${x}-${y}`, 1, family, x, y, ...metricRow(primary, sane)].join(','));
  }
  fs.writeFileSync(filePath, Buffer.from(zipSync({
    [Registry.CSV_MEMBER]: strToU8(`${rows.join('\n')}\n`),
    [Registry.DESCRIPTOR_MEMBER]: strToU8(JSON.stringify(descriptor))
  })));
}

function invoke(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

assert.deepEqual(PressureTest.summarizeDistribution([0, 10]), {
  q1: 2.5,
  median: 5,
  q3: 7.5,
  iqr: 5
});
assert.deepEqual(PressureTest.summarizeDistribution([4]), {
  q1: 4,
  median: 4,
  q3: 4,
  iqr: 0
});
assert.equal(PressureTest.quantile([], 0.5), null);
assert.equal(PressureTest.minimumBoundaryComponentSupport(1200), 12);
assert.equal(PressureTest.minimumBoundaryComponentSupport(100), 5);
assert.equal(PressureTest.minimumLevelSupport(1200), 6);
assert.equal(PressureTest.coherentMinimumCells(100, PressureTest.loadPolicy()), 5);
assert.equal(PressureTest.coherentMinimumCells(240, PressureTest.loadPolicy()), 12);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pressure-test-mostly-dead-v001-'));
try {
  const registryRoot = path.join(temp, 'registry');
  const packagePath = path.join(temp, 'fixture.surface.zip');
  writeFixture(packagePath);
  const registry = Registry.createFilesystemRegistry({ registryRoot });
  registry.registerPackage(packagePath, { surfaceId: 'pressure-fixture' });
  const indexPath = path.join(registryRoot, Registry.INDEX_FILE);
  const record = registry.listSurfaces()[0];
  const storedPackagePath = path.join(registryRoot, record.path);
  const beforeIndex = fs.readFileSync(indexPath);
  const beforePackageHash = sha256(storedPackagePath);

  const result = invoke(['--registry', registryRoot, '--surface-id', 'pressure-fixture']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'post_result_exploratory_non_authoritative');
  assert.equal(report.policy.authoritative, false);
  assert.equal(report.policy.frozen, false);
  assert.equal(report.summary.regime_contexts, 1);
  assert.equal(report.summary.families, 3);
  assert.deepEqual(report.summary.classifications, {
    PARAMETER_SHAPE_ADEQUACY: 1,
    BOUNDED_RESCUE: 1,
    STOP_FAMILY: 1
  });

  const families = Object.fromEntries(report.contexts[0].families.map(family => [family.family_context.family, family]));
  assert.equal(families.alive.sanity_fraction, 0.10);
  assert.equal(families.alive.mostly_dead, false);
  assert.equal(families.alive.classification, 'PARAMETER_SHAPE_ADEQUACY');

  assert.equal(families.rescue.sane_cells, 18);
  assert.equal(families.rescue.largest_sane_component_cells, 18);
  assert.equal(families.rescue.largest_sane_component_fraction, 0.015);
  assert.equal(families.rescue.coherent_survival, false);
  assert.equal(families.rescue.mostly_dead, true);
  assert.equal(families.rescue.edge_tests['x:max'].qualified, true);
  assert.equal(families.rescue.edge_tests['x:max'].component_tests[0].component_support_required, 12);
  assert.deepEqual(families.rescue.edge_tests['x:max'].component_tests[0].level_support, [6, 6, 6]);
  assert.equal(families.rescue.classification, 'BOUNDED_RESCUE');

  assert.equal(families.dead.mostly_dead, true);
  assert.equal(families.dead.classification, 'STOP_FAMILY');
  assert.equal(Object.values(families.dead.edge_tests).some(test => test.qualified), false);

  assert.deepEqual(fs.readFileSync(indexPath), beforeIndex, 'pressure test must not mutate the registry index');
  assert.equal(sha256(storedPackagePath), beforePackageHash, 'pressure test must not mutate the registered package');

  const canonical = registry.resolveSurface('pressure-fixture');
  const invalid = {
    ...canonical,
    metrics: { ...canonical.metrics, expectancy_per_contract: Float64Array.from(canonical.metrics.expectancy_per_contract) }
  };
  for (let i = 0; i < 121; i++) invalid.metrics.expectancy_per_contract[i] = Number.NaN;
  const invalidReport = PressureTest.analyzeSurface(invalid, { surfaceId: 'invalid-support' });
  const invalidFamily = invalidReport.contexts[0].families[0];
  assert.equal(invalidFamily.missing_fraction, 121 / 1200);
  assert.equal(invalidFamily.classification, 'STOP_FAMILY');
  assert.equal(invalidFamily.reason, 'INVALID_ANALYSIS_SUPPORT');

  const envResult = invoke(['--surface-id', 'pressure-fixture'], { SURFACE_ANALYZER_REGISTRY: registryRoot });
  assert.equal(envResult.status, 0, envResult.stderr);
  assert.equal(JSON.parse(envResult.stdout).surface.surface_id, 'pressure-fixture');

  const missingSurface = invoke(['--registry', registryRoot, '--surface-id', 'missing']);
  assert.notEqual(missingSurface.status, 0);
  assert.match(missingSurface.stderr, /Unknown surface_id/);

  console.log('PASS  exploratory mostly-dead pressure test is deterministic, family-local, and registry-read-only');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
