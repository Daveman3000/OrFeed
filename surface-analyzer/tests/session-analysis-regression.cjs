'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const semantic = require(path.join(ROOT, 'semantic-analysis-v030.js'));
const sessionApi = require(path.join(ROOT, 'core', 'surface-analyzer-session-v001.js'));

function fixture() {
  return {
    fileName: 'session-analysis.surface.zip',
    fileSize: 101,
    rows: 2,
    cols: 3,
    metrics: {
      r_per_trade: Float64Array.from([0, 1, 2, 0.2, 1.2, 2.2])
    },
    semanticDescriptor: {
      descriptor_schema_version: 1,
      descriptor_version: 'session-analysis-v1',
      study_id: 'session-analysis',
      provenance: { source_sha256: 'session-analysis-sha' },
      parameters: [
        { id: 'x', topology_role: 'ordered', source: 'outer', values: [0, 1, 2], active_when: 'always' },
        { id: 'f', topology_role: 'facet', source: 'inner', values: [0, 1], active_when: 'always' }
      ],
      layout: {
        x_parameter_order: ['x'],
        y_parameter_order: ['f']
      }
    },
    semanticAxis: {
      x: [{x:0},{x:1},{x:2}],
      y: [{f:0},{f:1}]
    },
    semanticParameterIndices: {
      x: Int16Array.from([0,1,2,0,1,2]),
      f: Int16Array.from([0,0,0,1,1,1])
    }
  };
}

(async function main(){
  const surface = fixture();
  const session = sessionApi.createSession({semanticEngine:semantic});
  const events = [];
  session.subscribe(event => events.push(event.type));
  await session.loadSurface(surface);

  const directTopology = semantic.buildTopology(surface);
  const sessionTopology = session.ensureTopology();
  assert.equal(sessionTopology.hardSurfaceCount, directTopology.hardSurfaceCount);
  assert.equal(sessionTopology.components, directTopology.components);
  assert.equal(sessionTopology.undirectedEdgeCount, directTopology.undirectedEdgeCount);
  assert.deepEqual(Array.from(sessionTopology.offsets), Array.from(directTopology.offsets));
  assert.deepEqual(Array.from(sessionTopology.neighbors), Array.from(directTopology.neighbors));
  assert.strictEqual(session.ensureTopology(), sessionTopology, 'topology should be cached by domain identity');

  const directSR = semantic.computeSR(surface.metrics.r_per_trade,directTopology);
  const sessionSR = session.computeStructuralRobustness('r_per_trade');
  assert.deepEqual(Array.from(sessionSR.structural_robustness), Array.from(directSR.structural_robustness));
  assert.strictEqual(session.computeStructuralRobustness('r_per_trade'), sessionSR, 'SR result should be cached');

  const directFR = semantic.computeFR(surface.metrics.r_per_trade,directTopology);
  const sessionFR = session.computeFacetReplication('r_per_trade');
  assert.deepEqual(Array.from(sessionFR.facet_replication), Array.from(directFR.facet_replication));
  assert.deepEqual(sessionFR.raw.diagnostics, directFR.raw.diagnostics);
  assert.strictEqual(session.computeFacetReplication('r_per_trade'), sessionFR, 'FR result should be cached');

  const state = session.getState();
  assert.equal(state.hasTopology, true);
  assert.deepEqual(state.structuralRobustnessMetrics, ['r_per_trade']);
  assert.deepEqual(state.facetReplicationMetrics, ['r_per_trade']);
  assert.ok(state.topologyIdentity.includes(state.domainIdentity));
  assert.deepEqual(events, ['surfaceLoaded','topologyComputed','analysisComputed','analysisComputed']);

  console.log('PASS  session topology/SR/FR delegate exactly to existing semantic engine');
})();
