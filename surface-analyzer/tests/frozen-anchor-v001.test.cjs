'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Semantic = require('../semantic-analysis-v030.js');
const Scan = require('../scan-layer-v033.js');
const Frozen = require('../node/frozen-anchor-v001.cjs');

const descriptor = {
  parameters: [
    { id: 'regime', topology_role: 'regime', source: 'outer', values: [0], active_when: 'always' },
    { id: 'mode', topology_role: 'facet', source: 'outer', values: [0, 1], active_when: 'always' },
    { id: 'x', topology_role: 'ordered', source: 'outer', values: [0, 1, 2], active_when: 'always' },
    { id: 'conditional', topology_role: 'ordered', source: 'outer', values: [0, 1], active_when: { op: 'eq', parameter: 'mode', value: 1 } }
  ]
};

const rows = [
  { key: 'a0', mode: 0, x: 0, conditional: -1 },
  { key: 'a1', mode: 0, x: 1, conditional: -1 },
  { key: 'a2', mode: 0, x: 2, conditional: -1 },
  ...[0, 1, 2].flatMap(x => [0, 1].map(conditional => ({ key: `b${x}${conditional}`, mode: 1, x, conditional })))
];

function fixture(order = rows) {
  const n = order.length;
  const indices = {
    regime: Int16Array.from(order.map(() => 0)),
    mode: Int16Array.from(order.map(row => row.mode)),
    x: Int16Array.from(order.map(row => row.x)),
    conditional: Int16Array.from(order.map(row => row.conditional))
  };
  const surface = {
    rows: n, cols: 1,
    semanticDescriptor: descriptor,
    semanticParameterIndices: indices,
    supportFields: { trades: Int32Array.from(order.map(() => 30)) },
    metrics: {
      r_per_trade: Float64Array.from(order.map(row => row.x + row.mode * .25 + 1)),
      profit_factor: Float64Array.from(order.map(row => row.x + row.mode * .25 + 2)),
      romad: Float64Array.from(order.map(row => row.x + row.mode * .25 + 3))
    }
  };
  const graph = Semantic.buildTopology(surface);
  const fixed = descriptor.parameters.filter(p => ['regime', 'facet'].includes(p.topology_role));
  const keyToIndex = new Map(order.map((row, index) => [row.key, index]));
  const bindings = { descriptor_sha256: 'synthetic', cleaned_domain_identity: 'synthetic', topology_engine_version: graph.version };
  const anchor = {
    region_id: 'synthetic-anchor',
    context_id: Frozen.contextId(Frozen.contextFor(surface, keyToIndex.get('a1'), fixed)),
    context: Frozen.contextFor(surface, keyToIndex.get('a1'), fixed),
    performance_class: 'P1', highest_supported_rung: 1, rr_anchor_rung: 1,
    cell_count: 1, analysis_keys: ['a1'], anchor_membership_sha256: Frozen.membershipHash(['a1'])
  };
  const artifact = { policy_origin: 'post_result_exploratory', bindings, anchors: [anchor] };
  return {
    surface, graph, fixed, keyToIndex, bindings, anchor, artifact,
    manifest: { campaign_id: 'synthetic-step4' },
    keysByIndex: order.map(row => row.key),
    physicalCellCount: n,
    physicalIndexByCell: Int32Array.from({ length: n }, (_, index) => index),
    physicalKeysByIndex: order.map(row => row.key)
  };
}

function materializationFixture({ sparse = false } = {}) {
  const count = 20, keysByIndex = Array.from({ length: count }, (_, index) => `m${String(index).padStart(2, '0')}`);
  const materializationDescriptor = {
    parameters: [
      { id: 'regime', topology_role: 'regime', source: 'outer', values: [0], active_when: 'always' },
      { id: 'mode', topology_role: 'facet', source: 'outer', values: [0], active_when: 'always' },
      { id: 'x', topology_role: 'ordered', source: 'outer', values: Array.from({ length: count }, (_, index) => index), active_when: 'always' }
    ]
  };
  const surface = {
    rows: count, cols: 1,
    semanticDescriptor: materializationDescriptor,
    semanticParameterIndices: { regime: new Int16Array(count), mode: new Int16Array(count), x: Int16Array.from({ length: count }, (_, index) => index) },
    supportFields: { trades: Int32Array.from({ length: count }, () => 30) },
    metrics: {
      r_per_trade: Float64Array.from({ length: count }, () => 0.6),
      profit_factor: Float64Array.from({ length: count }, () => 1.6),
      romad: Float64Array.from({ length: count }, () => 2.5)
    }
  };
  const graph = Semantic.buildTopology(surface), fixed = materializationDescriptor.parameters.filter(parameter => ['regime', 'facet'].includes(parameter.topology_role));
  const physicalCellCount = sparse ? count + 2 : count;
  return {
    surface, graph, fixed, keysByIndex, keyToIndex: new Map(keysByIndex.map((key, index) => [key, index])),
    bindings: { descriptor_sha256: 'materialization-synthetic', cleaned_domain_identity: sparse ? 'sparse' : 'rectangular', topology_engine_version: graph.version },
    manifest: { campaign_id: 'synthetic-step4' },
    physicalCellCount,
    physicalIndexByCell: Int32Array.from({ length: count }, (_, index) => sparse ? index + 1 : index),
    physicalKeysByIndex: sparse ? ['excluded-left', ...keysByIndex, 'excluded-right'] : keysByIndex
  };
}

assert.equal(Frozen.membershipPreimage(['a0', 'a1']).toString('hex'), Buffer.from('a0\na1\n').toString('hex'));
assert.throws(() => Frozen.membershipHash(['a1', 'a1']), /sorted and unique/);
assert.throws(() => Frozen.membershipHash(['a1', 'a0']), /sorted and unique/);
const f = fixture();
assert.deepEqual(Frozen.verifyAnchor(f, f.artifact, f.anchor), [1]);
const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'step4-membership-bundle-'));
const materializationSource = materializationFixture();
const materialized = Frozen.materializeAnchors(materializationSource, { regionPrefix: 'TEST', bundleRoot });
assert.equal(materialized.schema_version, 2);
assert.equal(materialized.artifact_version, '2');
assert.equal(materialized.membership_bundle.cleaned_domain_mask.kind, 'ALL_PHYSICAL_CELLS');
assert.equal(materialized.membership_bundle.region_order, 'MEMBERSHIP_HASH_LEXICOGRAPHIC');
assert.equal(materialized.membership_bundle.canonical_physical_cell_order.sha256, Frozen.canonicalPhysicalOrderHash(materializationSource.physicalKeysByIndex));
assert.deepEqual(materialized.membership_bundle.regions.map(region => region.membership_sha256), [...materialized.membership_bundle.regions.map(region => region.membership_sha256)].sort());
const materializedBytes = fs.readFileSync(path.join(bundleRoot, `${materialized.membership_bundle.sha256}.masks.bin`));
assert.equal(crypto.createHash('sha256').update(materializedBytes).digest('hex'), materialized.membership_bundle.sha256);
for (const region of materialized.membership_bundle.regions) {
  const bytes = materializedBytes.subarray(region.offset_bytes, region.offset_bytes + region.length_bytes);
  assert.equal([...bytes].reduce((sum, byte) => sum + byte.toString(2).replaceAll('0', '').length, 0), region.cell_count);
}
const sparse = materializationFixture({ sparse: true });
const sparseMaterialized = Frozen.materializeAnchors(sparse, { regionPrefix: 'TEST-SPARSE', bundleRoot });
assert.equal(sparseMaterialized.membership_bundle.cleaned_domain_mask.kind, 'BUNDLE_BITSET');
assert.equal(sparseMaterialized.membership_bundle.cleaned_domain_mask.cell_count, sparse.graph.N);
assert.equal(sparseMaterialized.membership_bundle.regions[0].offset_bytes, sparseMaterialized.membership_bundle.bytes_per_mask);
fs.rmSync(bundleRoot, { recursive: true, force: true });
const exact = Scan.analyzeFrozenAnchor(f.surface, f.graph, [1], ['r_per_trade'], () => false);
assert.equal(exact.definition, 'frozen_anchor_membership');
assert.equal(exact.regions[0].cell_count, 1);
assert.equal(exact.regions[0].metrics.r_per_trade.boundary_edges, 2);
assert.equal(exact.regions[0].metrics.r_per_trade.interior_edges, 0);
const peer = Semantic.matchedFacetPeers(f.graph, 1, 'mode');
assert.deepEqual(peer.alternatives[0].peers.map(i => rows[i].key).sort(), ['b10', 'b11']);
const evidence = Frozen.evaluateAnchor(f, f.artifact, f.anchor);
assert.equal(evidence.rr.cell_count, 1);
assert.equal(evidence.rr.metrics.r_per_trade.boundary_edges, 2);
assert.equal(evidence.fr.mode.unique_matched_peers, 2);
assert.equal(evidence.fr.mode.economic_replication.joint_p1_peer_cells, 2);
const lowSupportPeer = fixture();
lowSupportPeer.surface.supportFields.trades[lowSupportPeer.keyToIndex.get('b10')] = 10;
assert.equal(Frozen.evaluateAnchor(lowSupportPeer, lowSupportPeer.artifact, lowSupportPeer.anchor).fr.mode.economic_replication.joint_p1_peer_cells, 1);
const noLegalPeer = fixture(rows.filter(row => row.key !== 'b10' && row.key !== 'b11'));
assert.deepEqual(Semantic.matchedFacetPeers(noLegalPeer.graph, 1, 'mode').alternatives[0].peers, []);

function altered(patch) {
  const anchor = { ...f.anchor, ...patch };
  return { ...f.artifact, anchors: [anchor] };
}
let artifact = altered({ analysis_keys: ['a1', 'a1'], cell_count: 2 });
assert.throws(() => Frozen.verifyAnchor(f, artifact, artifact.anchors[0]), /sorted and unique/);
artifact = altered({ analysis_keys: ['not-present'], anchor_membership_sha256: Frozen.membershipHash(['not-present']) });
assert.throws(() => Frozen.verifyAnchor(f, artifact, artifact.anchors[0]), /Missing or outside-cleaned-domain/);
artifact = altered({ analysis_keys: ['b10'], anchor_membership_sha256: Frozen.membershipHash(['b10']) });
assert.throws(() => Frozen.verifyAnchor(f, artifact, artifact.anchors[0]), /Wrong-context/);
artifact = altered({ anchor_membership_sha256: '0'.repeat(64) });
assert.throws(() => Frozen.verifyAnchor(f, artifact, artifact.anchors[0]), /membership hash mismatch/);
artifact = { ...f.artifact, bindings: { ...f.bindings, cleaned_domain_identity: 'wrong' } };
assert.throws(() => Frozen.verifyAnchor(f, artifact, f.anchor), /binding mismatch/);

const permuted = fixture([...rows].reverse());
const reversedAnchorIndex = permuted.keyToIndex.get('a1');
const permutedExact = Scan.analyzeFrozenAnchor(permuted.surface, permuted.graph, [reversedAnchorIndex], ['r_per_trade'], () => false);
assert.deepEqual(permutedExact.regions[0].metrics.r_per_trade, exact.regions[0].metrics.r_per_trade);
assert.deepEqual(Semantic.matchedFacetPeers(permuted.graph, reversedAnchorIndex, 'mode').alternatives[0].peers.map(i => [...rows].reverse()[i].key).sort(), ['b10', 'b11']);
const srOriginal = Semantic.computeSR(f.surface.metrics.r_per_trade, f.graph).structural_robustness[1];
const srPermuted = Semantic.computeSR(permuted.surface.metrics.r_per_trade, permuted.graph).structural_robustness[reversedAnchorIndex];
assert.ok(Math.abs(srOriginal - srPermuted) < 1e-7);
const permutedEvidence = Frozen.evaluateAnchor(permuted, permuted.artifact, permuted.anchor);
assert.deepEqual(permutedEvidence.sr, evidence.sr);
assert.deepEqual(permutedEvidence.fr, evidence.fr);
assert.deepEqual(permutedEvidence.rr.metrics, evidence.rr.metrics);

const artifactPath = path.join(__dirname, '..', 'policies', 'exploratory', 'volume-bands-step4-frozen-anchors-v001.json');
const evidencePath = path.join(__dirname, '..', 'policies', 'exploratory', 'volume-bands-step5-anchor-evidence-v001.json');
const artifactBytes = fs.readFileSync(artifactPath);
const realArtifact = JSON.parse(artifactBytes);
const realEvidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
assert.equal(realEvidence.anchor_artifact_sha256, crypto.createHash('sha256').update(artifactBytes).digest('hex'));
assert.equal(realArtifact.anchors.length, 7);
assert.equal(realArtifact.anchors.reduce((sum, anchor) => sum + anchor.cell_count, 0), 462);
assert.deepEqual(realArtifact.anchors.map(anchor => anchor.performance_class).sort(), ['P10', 'P13', 'P13', 'P14', 'P14', 'P16', 'P16']);
assert.equal(realEvidence.results.length, realArtifact.anchors.length);
assert.ok(realEvidence.results.some(result => result.fr.weighting_mode.unique_matched_peers > 0));
assert.ok(realEvidence.results.some(result => result.fr.weighting_mode.evidence_status === 'UNSUPPORTED'));
assert.ok(realEvidence.results.every(result => result.fr.average_mode.evidence_status === 'N/A'));
for (const anchor of realArtifact.anchors) {
  assert.equal(anchor.anchor_membership_sha256, Frozen.membershipHash(anchor.analysis_keys));
  const result = realEvidence.results.find(item => item.region_id === anchor.region_id);
  assert.equal(result.anchor_membership_sha256, anchor.anchor_membership_sha256);
  assert.equal(result.rr.cell_count, anchor.cell_count);
}

console.log('PASS frozen-anchor identity, exact RR boundary, activation-aware FR peers, and permutation acceptance');
