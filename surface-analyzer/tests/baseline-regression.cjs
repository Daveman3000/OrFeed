'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const topology = require(path.join(ROOT, 'robustness-topology-v016.js'));
const semantic = require(path.join(ROOT, 'semantic-analysis-v030.js'));
const scanner = require(path.join(ROOT, 'scan-layer-v033.js'));
const sessionApi = require(path.join(ROOT, 'core', 'surface-analyzer-session-v001.js'));
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

function sessionSurface() {
  return {
    fileName: 'session-test.surface.zip',
    fileSize: 123,
    rows: 2,
    cols: 2,
    metrics: {
      r_per_trade: Float64Array.from([0.1, 0.2, 0.3, 0.4])
    },
    semanticDescriptor: {
      descriptor_schema_version: 1,
      descriptor_version: 'session-test-v1',
      study_id: 'session-test',
      provenance: { source_sha256: 'session-test-sha' },
      parameters: [
        { id: 'x', topology_role: 'ordered', values: [0, 1], active_when: 'always' },
        { id: 'y', topology_role: 'ordered', values: [0, 1], active_when: 'always' }
      ],
      layout: {
        x_parameter_order: ['x'],
        y_parameter_order: ['y']
      }
    },
    semanticParameterIndices: {
      x: Int16Array.from([0, 1, 0, 1]),
      y: Int16Array.from([0, 0, 1, 1])
    }
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

  await check('session load owns one canonical source/domain', async () => {
    const surface = sessionSurface();
    const session = sessionApi.createSession();
    const events = [];
    session.subscribe(event => events.push(event.type));

    const state = await session.loadSurface(surface);
    assert.equal(state.revision, 1);
    assert.equal(state.hasSurface, true);
    assert.equal(state.sourceIdentity, 'session-test:sha:session-test-sha');
    assert.equal(state.domainIdentity, 'session-test:sha:session-test-sha|filter:none');
    assert.strictEqual(session.getSourceSurface(), surface);
    assert.strictEqual(session.getFilteredSurface(), surface);
    assert.deepEqual(events, ['surfaceLoaded']);
  });

  await check('session load is atomic on validation/storage failure', async () => {
    const surface = sessionSurface();
    let stored = null;
    const session = sessionApi.createSession({
      storageAdapter: {
        async get(){ return stored; },
        async set(_key,value){ stored = value; },
        async remove(){ stored = null; }
      }
    });
    await session.loadSurface(surface,{persist:true});
    const before = session.getState();

    await assert.rejects(
      () => session.loadSurface({ rows: 2, cols: 2, metrics: { bad: [1] } }),
      /metric length/
    );
    assert.strictEqual(session.getSourceSurface(), surface);
    assert.deepEqual(session.getState(), before);

    const failing = sessionApi.createSession({
      storageAdapter: {
        async set(){ throw new Error('storage failed'); }
      }
    });
    await assert.rejects(() => failing.loadSurface(surface,{persist:true}), /storage failed/);
    assert.equal(failing.getState().hasSurface, false);
  });

  await check('session restore and persistent clear use the same load state', async () => {
    const surface = sessionSurface();
    let stored = surface;
    const adapter = {
      async get(){ return stored; },
      async set(_key,value){ stored = value; },
      async remove(){ stored = null; }
    };
    const session = sessionApi.createSession({storageAdapter:adapter});
    const restored = await session.restore();
    assert.equal(restored.hasSurface, true);
    assert.strictEqual(session.getSourceSurface(), surface);
    assert.equal(restored.sourceIdentity, 'session-test:sha:session-test-sha');

    const cleared = await session.clear({removePersisted:true});
    assert.equal(cleared.hasSurface, false);
    assert.equal(stored, null);
  });

  const failed = checks.filter(x => !x.ok);
  if (failed.length) {
    console.error(`\n${failed.length} baseline check(s) failed.`);
    process.exitCode = 1;
  } else {
    console.log(`\n${checks.length} baseline checks passed.`);
  }
})();
