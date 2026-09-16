'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const topology = require(path.join(ROOT, 'robustness-topology-v016.js'));
const semantic = require(path.join(ROOT, 'semantic-analysis-v030.js'));
const scanner = require(path.join(ROOT, 'scan-layer-v033.js'));
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'metrics.json'), 'utf8'));

const checks = [];

async function check(name, fn) {
  try {
    await fn();
    checks.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error });
    console.error(`FAIL  ${name}`);
    console.error(error && error.stack ? error.stack : error);
  }
}

function lineGraph4() {
  return {
    offsets: Int32Array.from([0, 1, 3, 5, 6]),
    neighbors: Int32Array.from([1, 0, 2, 1, 3, 2]),
    hardIndex: Int32Array.from([0, 0, 0, 0]),
    hardCells: [[0, 1, 2, 3]],
    info: {
      regimes: [],
      facets: [],
      ordered: [0],
      defs: [{ id: 'x', values: [0, 1, 2, 3] }]
    },
    paramArrays: [Int16Array.from([0, 1, 2, 3])]
  };
}

(async function main() {
  await check('generic semantic synthetic suite', () => {
    const result = semantic.runSyntheticSuite();
    assert.equal(result.passed, true, JSON.stringify(result, null, 2));
  });

  await check('VolSpike topology oracle', () => {
    assert.equal(meta.__order__.length, 250, 'metrics.json visual order must contain 250 inner configurations');
    const configs = topology.buildVolspikeConfigs(224, 250, meta.__order__);
    const graph = topology.buildSemanticGraph(configs, topology.DESCRIPTOR);

    assert.equal(graph.surfaceCells.size, 6, 'hard-surface count changed');
    assert.equal(graph.components, 160, 'facet-component count changed');
    assert.equal(graph.undirectedEdgeCount, 183520, 'semantic edge count changed');
    assert.equal(graph.missingExpectedDirect, 0, 'expected semantic neighbors are missing');
  });

  await check('scanner midrank percentile semantics', () => {
    const out = scanner.midrankPercentile(Float64Array.from([1, 2, 2, 4]), false);
    assert.deepEqual(Array.from(out), [0, 50, 50, 100]);

    const inverted = scanner.midrankPercentile(Float64Array.from([1, 2, 2, 4]), true);
    assert.deepEqual(Array.from(inverted), [100, 50, 50, 0]);
  });

  await check('scanner semantic connectivity + min_cells', () => {
    const graph = lineGraph4();
    const mask = Uint8Array.from([1, 1, 1, 0]);
    const regions = scanner.connectedRegions(mask, graph, 2);

    assert.equal(regions.regions.length, 1);
    assert.deepEqual(regions.regions[0], [0, 1, 2]);
    assert.deepEqual(Array.from(regions.mask), [1, 1, 1, 0]);
  });

  await check('scanner evaluateScan baseline', async () => {
    const graph = lineGraph4();
    const surface = {
      rows: 1,
      cols: 4,
      metrics: { metric: Float64Array.from([1, 1, 1, 0]) }
    };
    const config = {
      criteria: [{
        id: 'performance',
        enabled: true,
        source: 'performance',
        metric: 'metric',
        basis: 'raw',
        operator: '>=',
        value: 0.5
      }],
      region_rules: { min_cells: 2 }
    };

    const result = await scanner.evaluateScan(surface, config, graph, async () => surface.metrics.metric);
    assert.equal(result.passingCells, 3);
    assert.equal(result.regions.length, 1);
    assert.equal(result.regions[0].cell_count, 3);
    assert.deepEqual(Array.from(result.mask), [1, 1, 1, 0]);
  });

  await check('regional robustness baseline', () => {
    const graph = lineGraph4();
    const surface = {
      rows: 1,
      cols: 4,
      metrics: { metric: Float64Array.from([1, 1, 1, 0]) }
    };
    const performanceMask = Uint8Array.from([1, 1, 1, 0]);
    const result = scanner.analyzeRegionalRobustness(
      surface,
      graph,
      performanceMask,
      2,
      ['metric'],
      () => false
    );

    assert.equal(result.definition, 'performance_criteria_only');
    assert.equal(result.regions.length, 1);
    assert.equal(result.regions[0].cell_count, 3);
    assert.equal(result.regions[0].metrics.metric.boundary_edges, 1);
    assert.equal(result.regions[0].metrics.metric.boundary_mean_raw_drop, 1);
  });

  const failed = checks.filter(x => !x.ok);
  if (failed.length) {
    console.error(`\n${failed.length} baseline check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\n${checks.length} baseline checks passed.`);
  }
})();
