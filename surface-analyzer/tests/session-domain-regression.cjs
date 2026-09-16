'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const sessionApi = require(path.join(ROOT, 'core', 'surface-analyzer-session-v001.js'));
const filterEngine = require(path.join(ROOT, 'core', 'surface-filter-engine-v001.js'));

function fixture() {
  return {
    fileName: 'session-filter-test.surface.zip',
    fileSize: 789,
    rows: 2,
    cols: 3,
    metrics: {
      r_per_trade: Float64Array.from([0, 1, 2, 3, 4, 5])
    },
    semanticDescriptor: {
      descriptor_schema_version: 1,
      descriptor_version: 'session-filter-test-v1',
      study_id: 'session-filter-test',
      provenance: { source_sha256: 'session-filter-sha' },
      parameters: [
        { id: 'regime', topology_role: 'regime', values: [0, 1], active_when: 'always' },
        { id: 'x', topology_role: 'ordered', values: [10, 20, 30], active_when: 'always' }
      ],
      layout: {
        x_parameter_order: ['x'],
        y_parameter_order: ['regime']
      }
    },
    semanticAxis: {
      x: [{x:10},{x:20},{x:30}],
      y: [{regime:0},{regime:1}]
    },
    semanticParameterIndices: {
      regime: Int16Array.from([0, 0, 0, 1, 1, 1]),
      x: Int16Array.from([0, 1, 2, 0, 1, 2])
    }
  };
}

(async function main(){
  const source = fixture();
  const session = sessionApi.createSession({filterEngine});
  const events = [];
  session.subscribe(event => events.push(event.type));

  await session.loadSurface(source);
  const filteredState = session.setFilter({regime:[1],x:[0,2]});
  const filtered = session.getFilteredSurface();

  assert.strictEqual(session.getSourceSurface(), source, 'sourceSurface must remain canonical and unchanged');
  assert.notStrictEqual(filtered, source, 'filtered domain must be a separate materialized surface');
  assert.equal(filtered.rows, 1);
  assert.equal(filtered.cols, 2);
  assert.deepEqual(Array.from(filtered.metrics.r_per_trade), [3,5]);
  assert.deepEqual(filteredState.filterSpec, {regime:[1],x:[0,2]});
  assert.equal(filteredState.domainIdentity, 'session-filter-test:sha:session-filter-sha|filter:{"regime":[1],"x":[0,2]}');
  assert.deepEqual(events, ['surfaceLoaded','filterChanged']);

  const beforeInvalid = session.getState();
  const beforeSurface = session.getFilteredSurface();
  assert.throws(() => session.setFilter({regime:[],x:[0]}), /removes every declared value/);
  assert.deepEqual(session.getState(), beforeInvalid, 'failed filter must not mutate session state');
  assert.strictEqual(session.getFilteredSurface(), beforeSurface, 'failed filter must preserve prior domain');

  const cleared = session.clearFilter();
  assert.strictEqual(session.getFilteredSurface(), source, 'clearFilter must restore the canonical source domain');
  assert.equal(cleared.filterSpec, null);
  assert.equal(cleared.domainIdentity, 'session-filter-test:sha:session-filter-sha|filter:none');
  assert.deepEqual(events, ['surfaceLoaded','filterChanged','filterCleared']);

  console.log('PASS  session filtered-domain ownership + atomic filter failure');
})();
