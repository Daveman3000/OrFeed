'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { strToU8, zipSync } = require(require.resolve('fflate', { paths: [path.join(__dirname, '..', 'node')] }));
const Registry = require('../node/surface-registry-v001.cjs');

const ROOT = path.resolve(__dirname, '..');
const RUNNER = path.join(ROOT, 'node', 'research-runner-v001.cjs');

function writeFixture(filePath) {
  const metrics = ['r_per_trade', 'expectancy_per_contract', 'profit_factor', 'romad', 'max_drawdown_r', 'total_r'];
  const descriptor = {
    descriptor_schema_version: 1,
    descriptor_version: 'runner-test-v1',
    study_id: 'runner-fixture',
    provenance: { source_sha256: 'runner-source', source_row_count: 6 },
    results: { metrics },
    parameters: [
      { id: 'x', label: 'Length', type: 'integer', topology_role: 'ordered', source: 'outer', values: [10, 11, 12], active_when: 'always' },
      { id: 'f', label: 'Family', type: 'string', topology_role: 'facet', source: 'inner', values: ['A', 'B'], active_when: 'always' }
    ],
    layout: { x_parameter_order: ['x'], y_parameter_order: ['f'] }
  };
  const rows = ['analysis_key,x,f,' + metrics.join(',')];
  const values = [0.0, 0.5, 1.0, 0.2, 0.7, 1.2];
  let n = 0;
  for (const f of ['A', 'B']) for (const x of [10, 11, 12]) {
    const value = values[n++];
    rows.push([`${f}-${x}`, x, f, value, value * 2, 1 + value, value / 2, 7 - value, value * 3].join(','));
  }
  fs.writeFileSync(filePath, Buffer.from(zipSync({
    [Registry.CSV_MEMBER]: strToU8(`${rows.join('\n')}\n`),
    [Registry.DESCRIPTOR_MEMBER]: strToU8(JSON.stringify(descriptor))
  })));
}

function invoke(args, { input = '', env = {} } = {}) {
  return spawnSync(process.execPath, [RUNNER, ...args], {
    input,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

function parseSuccess(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

function assertCompact(value) {
  const forbidden = new Set(['mask', 'regionId', 'metric_grid', 'metric_grids', 'metric_values']);
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      assert.equal(forbidden.has(key), false, `compact output must omit ${key}`);
      visit(child);
    }
  }
  visit(value);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'research-runner-v001-'));
try {
  const registryRoot = path.join(temp, 'registry');
  const wrongRoot = path.join(temp, 'wrong-registry');
  const packagePath = path.join(temp, 'runner.surface.zip');
  const requestPath = path.join(temp, 'request.json');
  writeFixture(packagePath);
  Registry.createFilesystemRegistry({ registryRoot }).registerPackage(packagePath, { surfaceId: 'runner-fixture' });

  fs.writeFileSync(requestPath, JSON.stringify({ operation: 'list_surfaces' }));
  const listed = parseSuccess(invoke(['--registry', registryRoot, requestPath], {
    env: { SURFACE_ANALYZER_REGISTRY: wrongRoot }
  }));
  assert.equal(listed.operation, 'list_surfaces');
  assert.equal(listed.surfaces.length, 1);
  assert.equal(listed.surfaces[0].surface_id, 'runner-fixture');

  const described = parseSuccess(invoke([], {
    input: JSON.stringify({ operation: 'describe_surface', surface_id: 'runner-fixture' }),
    env: { SURFACE_ANALYZER_REGISTRY: registryRoot }
  }));
  assert.equal(described.operation, 'describe_surface');
  assert.equal(described.configurations, 6);
  assert.deepEqual(described.metrics, ['r_per_trade', 'expectancy_per_contract', 'profit_factor', 'romad', 'max_drawdown_r', 'total_r']);

  const analyzed = parseSuccess(invoke(['--registry', registryRoot], {
    input: JSON.stringify({
      operation: 'analyze_surface',
      surface_id: 'runner-fixture',
      domain: { x: [11, 12] },
      structural_robustness: ['r_per_trade'],
      facet_replication: ['r_per_trade'],
      scan: {
        criteria: [{ id: 'floor', enabled: true, source: 'performance', metric: 'r_per_trade', basis: 'raw', operator: '>=', value: 0.5 }],
        region_rules: { connectivity: 'semantic_ordered_graph', min_cells: 1 }
      },
      regional_robustness: true
    })
  }));
  assert.equal(analyzed.operation, 'analyze_surface');
  assert.equal(analyzed.research_domain.configurations, 4);
  assert.equal(analyzed.analyses.structural_robustness.r_per_trade.count, 4);
  assert.equal(analyzed.analyses.facet_replication.r_per_trade.count, 4);
  assert.ok(analyzed.scan.regional_robustness);
  assertCompact(analyzed);

  const missingRoot = invoke([], { input: JSON.stringify({ operation: 'list_surfaces' }), env: { SURFACE_ANALYZER_REGISTRY: '' } });
  assert.notEqual(missingRoot.status, 0);
  assert.equal(missingRoot.stdout, '');
  assert.match(missingRoot.stderr, /Registry root is required/);

  const missingSurface = invoke(['--registry', registryRoot], {
    input: JSON.stringify({ operation: 'describe_surface', surface_id: 'missing' })
  });
  assert.notEqual(missingSurface.status, 0);
  assert.equal(missingSurface.stdout, '');
  assert.match(missingSurface.stderr, /Unknown surface_id/);

  console.log('PASS  Node runner exposes compact Research API operations with deterministic CLI transport behavior');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
