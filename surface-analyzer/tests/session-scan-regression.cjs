'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const semantic = require(path.join(ROOT, 'semantic-analysis-v030.js'));
const scanner = require(path.join(ROOT, 'scan-layer-v033.js'));
const sessionApi = require(path.join(ROOT, 'core', 'surface-analyzer-session-v001.js'));

const metricMetadata = {
  r_per_trade: { invert:false },
  max_drawdown_r: { invert:true }
};

function fixture() {
  return {
    fileName: 'session-scan.surface.zip',
    fileSize: 202,
    rows: 2,
    cols: 3,
    metrics: {
      r_per_trade: Float64Array.from([0.0, 0.5, 1.0, 0.2, 0.7, 1.2]),
      profit_factor: Float64Array.from([1.5, 1.5, 2.0, 1.75, 1.75, 2.25]),
      romad: Float64Array.from([2, 2, 4, 3, 3, 5]),
      total_r: Float64Array.from([0, 12.5, 25, 5, 13.3, 30]),
      max_drawdown_r: Float64Array.from([5, 4, 3, 6, 5, 4])
    },
    supportFields: {
      trades: Int32Array.from([25, 25, 25, 25, 19, 25])
    },
    semanticDescriptor: {
      descriptor_schema_version: 1,
      descriptor_version: 'session-scan-v1',
      study_id: 'session-scan',
      provenance: { source_sha256: 'session-scan-sha' },
      results: { support_fields: [{ id:'trades', type:'integer', role:'sample_size' }] },
      parameters: [
        { id: 'x', topology_role: 'ordered', source: 'outer', values: [0,1,2], active_when: 'always' },
        { id: 'f', topology_role: 'facet', source: 'inner', values: [0,1], active_when: 'always' }
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
  const config = {
    scan_schema_version: 1,
    scan_id: 'session-scan-test',
    criteria_mode: 'all',
    criteria: [
      { id:'p_raw', enabled:true, source:'performance', metric:'r_per_trade', basis:'raw', operator:'>=', value:0.5 },
      { id:'p_score', enabled:true, source:'performance', metric:'p_score', basis:'raw', operator:'>=', value:2 },
      { id:'p_pct_inv', enabled:true, source:'performance', metric:'max_drawdown_r', basis:'percentile', operator:'>=', value:40 },
      { id:'sr', enabled:true, source:'structural_robustness', metric:'r_per_trade', basis:'score', operator:'>=', value:0 },
      { id:'fr', enabled:true, source:'facet_replication', metric:'r_per_trade', basis:'score', operator:'>=', value:0 }
    ],
    region_rules: { connectivity:'semantic_ordered_graph', min_cells:1, regional_robustness:true },
    display: { dim_nonpassing:true, outline_regions:true, show_matches_only:false }
  };

  assert.deepEqual(Array.from(scanner.performanceScoreSeries(surface)),[0,1,3,0,NaN,3],'P Score must use the frozen P1-P20 3/3 ladder and 20-trade floor');
  const inferredSurface={...surface,supportFields:{}};
  assert.deepEqual(Array.from(scanner.performanceScoreSeries(inferredSurface)),[NaN,1,3,0,NaN,3],'P Score must infer trade count from Total R / R per trade when the browser surface does not retain Trades');
  const g = semantic.buildTopology(surface);
  const sr = semantic.computeSR(surface.metrics.r_per_trade,g).structural_robustness;
  const fr = semantic.computeFR(surface.metrics.r_per_trade,g).facet_replication;
  const direct = await scanner.evaluateScan(surface,config,g,async c=>{
    if(c.source==='performance'){
      if(c.metric===scanner.P_SCORE_METRIC)return scanner.performanceScoreSeries(surface);
      const raw=surface.metrics[c.metric];
      return c.basis==='percentile'?scanner.midrankPercentile(raw,!!metricMetadata[c.metric]?.invert):raw;
    }
    if(c.source==='structural_robustness')return sr;
    if(c.source==='facet_replication')return fr;
    throw new Error(`unsupported ${c.source}`);
  });
  direct.regionalRobustness = scanner.analyzeRegionalRobustness(
    surface,
    g,
    direct.performanceMask,
    1,
    direct.performanceMetrics,
    metric=>!!metricMetadata[metric]?.invert,
    semantic.TAU
  );
  delete direct.performanceMask;

  const session = sessionApi.createSession({
    semanticEngine: semantic,
    scanEngine: scanner,
    metricMetadata
  });
  await session.loadSurface(surface);

  const invertedPct = session.getPerformanceSeries('max_drawdown_r',{basis:'percentile'});
  assert.deepEqual(
    Array.from(invertedPct),
    Array.from(scanner.midrankPercentile(surface.metrics.max_drawdown_r,true)),
    'percentile performance basis must preserve metric inversion'
  );

  const actual = await session.runScan(config);
  assert.deepEqual(Array.from(actual.mask), Array.from(direct.mask));
  assert.deepEqual(Array.from(actual.regionId), Array.from(direct.regionId));
  assert.equal(actual.passingCells, direct.passingCells);
  assert.equal(actual.totalCells, direct.totalCells);
  assert.deepEqual(actual.criteria, direct.criteria);
  assert.deepEqual(actual.regions, direct.regions);
  assert.deepEqual(actual.performanceMetrics, direct.performanceMetrics);
  assert.equal(actual.performanceCriteriaCount, direct.performanceCriteriaCount);
  assert.deepEqual(Array.from(actual.regionalRobustness.mask), Array.from(direct.regionalRobustness.mask));
  assert.deepEqual(Array.from(actual.regionalRobustness.regionId), Array.from(direct.regionalRobustness.regionId));
  assert.deepEqual(actual.regionalRobustness.regions, direct.regionalRobustness.regions);
  assert.strictEqual(session.getScanResult(), actual);
  assert.strictEqual(session.getRegionalRobustnessResult(), actual.regionalRobustness);
  assert.equal(session.getState().hasScanResult, true);
  assert.equal(session.getState().hasRegionalRobustnessResult, true);

  const savedConfig = session.getState().scanConfig;
  const cleared = session.clearScan();
  assert.equal(cleared.hasScanResult, false);
  assert.equal(cleared.hasRegionalRobustnessResult, false);
  assert.deepEqual(cleared.scanConfig, savedConfig, 'Clear Applied semantics must retain scan rules');

  console.log('PASS  session scan/RR delegates exactly to existing scanner engines');
})();
