'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');
const PackageCore = require('../surface-package-core-v001.js');
const Semantic = require('../semantic-analysis-v030.js');
const Scan = require('../scan-layer-v033.js');
const { createFilesystemRegistry } = require('./surface-registry-v001.cjs');

const ROOT = path.join(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'performance-qualification-step4-v001.json');
const CLEANED_PATH = path.join(ROOT, 'policies', 'exploratory', 'volume-bands-cleaned-domain-step3-v001.json');
const METRICS = ['r_per_trade', 'profit_factor', 'romad'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compareKeys = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = message => { throw new Error(message); };

function membershipPreimage(keys) {
  if (!Array.isArray(keys) || !keys.length) fail('Anchor membership must be a nonempty array.');
  for (let i = 0; i < keys.length; i++) {
    if (typeof keys[i] !== 'string' || !keys[i] || /[\r\n]/.test(keys[i])) fail('Invalid canonical analysis_key.');
    if (i && compareKeys(keys[i - 1], keys[i]) >= 0) fail('Anchor keys must be strictly sorted and unique.');
  }
  return Buffer.from(`${keys.join('\n')}\n`, 'utf8');
}

function membershipHash(keys) { return sha256(membershipPreimage(keys)); }
function sortedKeys(keys) { return [...keys].sort(compareKeys); }
function contextFor(surface, cell, fixed) {
  return Object.fromEntries(fixed.map(p => {
    const i = surface.semanticParameterIndices[p.id][cell];
    return [p.id, i < 0 ? null : p.values[i]];
  }));
}
function contextId(context) { return Object.entries(context).map(([id, value]) => `${id}=${JSON.stringify(value)}`).join('|'); }

function loadVolumeBands(registryRoot) {
  const manifest = JSON.parse(fs.readFileSync(CLEANED_PATH, 'utf8'));
  const policyBytes = fs.readFileSync(POLICY_PATH);
  const policy = JSON.parse(policyBytes);
  if (policy.frozen !== true || policy.authoritative !== false || policy.policy_origin !== 'post_result_exploratory') fail('Step 4 policy is not the frozen exploratory policy.');
  const surfacePolicyPath = path.join(ROOT, '..', manifest.surface_policy.path);
  if (sha256(fs.readFileSync(surfacePolicyPath)) !== manifest.surface_policy.sha256_exact_file_bytes) fail('Surface policy exact-byte identity mismatch.');
  if (sha256(Buffer.from(manifest.cleaned_domain_identity.identity_preimage_lines.join('\n'), 'utf8')) !== manifest.cleaned_domain_identity.cleaned_domain_sha256) fail('Cleaned-domain identity mismatch.');
  if (manifest.outcome_summary.removed_cells !== 0 || manifest.outcome_summary.retained_cells !== manifest.source_surface.source_cells) fail('This adapter requires the recorded all-retained Volume Bands cleaned domain.');
  const registry = createFilesystemRegistry({ registryRoot });
  const surfaceId = manifest.source_surface.surface_id;
  const record = registry.listSurfaces().find(x => x.surface_id === surfaceId);
  if (!record || record.sha256 !== manifest.source_surface.package_sha256) fail('Registered package identity mismatch.');
  const packagePath = path.join(registryRoot, record.path);
  const packageBytes = fs.readFileSync(packagePath);
  if (sha256(packageBytes) !== record.sha256) fail('Registered package hash mismatch.');
  const members = unzipSync(packageBytes);
  const descriptorBytes = members['surface_descriptor.json'];
  const csvBytes = members['surface.semantic.csv'];
  if (!descriptorBytes || !csvBytes || sha256(descriptorBytes) !== manifest.source_surface.descriptor_sha256) fail('Descriptor identity mismatch.');
  const surface = registry.resolveSurface(surfaceId);
  const graph = Semantic.buildTopology(surface);
  const params = surface.semanticDescriptor.parameters;
  const maps = params.map(p => new Map(p.values.map((value, i) => [String(value), i])));
  const keyByTuple = new Map();
  const keyToIndex = new Map();
  const csv = strFromU8(csvBytes);
  let header = null;
  PackageCore.eachCsvRow(csv, row => {
    if (!header) { header = Object.fromEntries(row.map((name, i) => [name.trim(), i])); return; }
    if (row.every(value => value === '')) return;
    const key = row[header.analysis_key];
    if (typeof key !== 'string' || !key || keyToIndex.has(key)) fail('Missing or duplicate CSV analysis_key.');
    const tuple = params.map((p, j) => {
      const value = row[header[p.id]];
      if (value === '') return -1;
      const index = maps[j].get(value);
      if (index === undefined) fail(`${p.id}: CSV value cannot be mapped to declared domain.`);
      return index;
    }).join(',');
    if (keyByTuple.has(tuple)) fail('Duplicate semantic coordinate in CSV.');
    keyByTuple.set(tuple, key);
    keyToIndex.set(key, -1);
  });
  const keysByIndex = new Array(graph.N);
  for (let i = 0; i < graph.N; i++) {
    const key = keyByTuple.get(params.map(p => surface.semanticParameterIndices[p.id][i]).join(','));
    if (!key) fail('Canonical surface cell is missing analysis_key.');
    keysByIndex[i] = key;
    keyToIndex.set(key, i);
  }
  if (keyToIndex.size !== graph.N) fail('CSV and canonical surface cell counts differ.');
  const retained = membershipHash(sortedKeys(keysByIndex));
  if (retained !== manifest.cleaned_domain_identity.retained_analysis_keys_sha256) fail('Cleaned-domain key membership mismatch.');
  const fixed = params.filter(p => p.topology_role === 'regime' || p.topology_role === 'facet');
  return {
    manifest, policy, surface, graph, fixed, keysByIndex, keyToIndex,
    bindings: {
      surface_id: surfaceId,
      package_sha256: record.sha256,
      descriptor_sha256: sha256(descriptorBytes),
      surface_policy_sha256: manifest.surface_policy.sha256_exact_file_bytes,
      cleaned_domain_identity: manifest.cleaned_domain_identity.cleaned_domain_sha256,
      step4_policy_id: policy.policy_id,
      step4_policy_version: policy.policy_version,
      step4_policy_sha256: sha256(policyBytes),
      topology_engine_version: graph.version
    }
  };
}

function components(cells, graph) {
  const allowed = new Set(cells), seen = new Set(), result = [];
  for (const seed of cells) {
    if (seen.has(seed)) continue;
    const queue = [seed], component = [];
    seen.add(seed);
    for (let at = 0; at < queue.length; at++) {
      const cell = queue[at]; component.push(cell);
      for (let e = graph.offsets[cell]; e < graph.offsets[cell + 1]; e++) {
        const neighbor = graph.neighbors[e];
        if (allowed.has(neighbor) && !seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
      }
    }
    result.push(component);
  }
  return result;
}

function threshold(k) { return { r_per_trade: (50 + 25 * (k - 1)) / 100, profit_factor: (150 + 25 * (k - 1)) / 100, romad: 2 + k - 1 }; }
function passes(surface, cell, k) {
  const t = threshold(k);
  return METRICS.every(metric => surface.metrics[metric][cell] >= t[metric]);
}
function nodeRecord(cells, rung, keysByIndex) {
  const keys = sortedKeys(cells.map(i => keysByIndex[i]));
  return { rung: `P${rung}`, cell_count: cells.length, membership_sha256: membershipHash(keys) };
}

function materializeAnchors(bundle, { regionPrefix = 'VB' } = {}) {
  const { surface, graph, fixed, keysByIndex, bindings } = bundle;
  const trades = surface.supportFields.trades;
  if (!(trades instanceof Int32Array)) fail('Canonical integer trades support is required.');
  const groups = new Map();
  for (let i = 0; i < graph.N; i++) {
    const context = contextFor(surface, i, fixed), id = contextId(context);
    if (!groups.has(id)) groups.set(id, { context_id: id, context, cells: [] });
    groups.get(id).cells.push(i);
  }
  const anchors = [];
  for (const group of [...groups.values()].sort((a, b) => compareKeys(a.context_id, b.context_id))) {
    const eligible = group.cells.filter(i => trades[i] >= 20 && METRICS.every(metric => Number.isFinite(surface.metrics[metric][i])));
    const p1 = eligible.filter(i => passes(surface, i, 1));
    const minimum = Math.max(16, Math.min(32, Math.ceil(0.005 * p1.length)));
    let active = components(p1, graph).filter(cells => cells.length >= minimum)
      .map(cells => ({ cells, rung: 1, ancestry: [nodeRecord(cells, 1, keysByIndex)] }));
    while (active.length) {
      const next = [];
      for (const node of active) {
        const children = node.rung < 20
          ? components(node.cells.filter(i => passes(surface, i, node.rung + 1)), graph).filter(cells => cells.length >= minimum)
          : [];
        if (children.length) {
          for (const cells of children) next.push({ cells, rung: node.rung + 1, ancestry: [...node.ancestry, nodeRecord(cells, node.rung + 1, keysByIndex)] });
          continue;
        }
        const analysisKeys = sortedKeys(node.cells.map(i => keysByIndex[i]));
        const membershipSha = membershipHash(analysisKeys);
        anchors.push({
          region_id: `${regionPrefix}-${membershipSha.slice(0, 16)}`,
          context_id: group.context_id,
          context: group.context,
          performance_class: `P${node.rung}`,
          highest_supported_rung: node.rung,
          rr_anchor_rung: node.rung,
          terminal_status: node.rung === 20 ? 'MAX_RUNG_REACHED' : 'NATURAL_TERMINAL',
          right_censored: node.rung === 20,
          cell_count: node.cells.length,
          minimum_component_support: minimum,
          anchor_membership_sha256: membershipSha,
          analysis_keys: analysisKeys,
          lineage_ancestry: node.ancestry
        });
      }
      active = next;
    }
  }
  anchors.sort((a, b) => compareKeys(a.context_id, b.context_id) || compareKeys(a.region_id, b.region_id));
  return { schema_version: 1, artifact_type: 'step4_terminal_frozen_anchors', policy_origin: 'post_result_exploratory', campaign_id: bundle.manifest.campaign_id, bindings, anchor_hash_preimage: 'UTF-8 sorted canonical analysis_keys joined by LF with final LF; no BOM', anchors };
}

function verifyAnchor(bundle, artifact, anchor) {
  if (artifact.policy_origin !== 'post_result_exploratory') fail('Wrong anchor provenance.');
  for (const [key, value] of Object.entries(bundle.bindings)) if (artifact.bindings?.[key] !== value) fail(`${key}: anchor binding mismatch.`);
  if (!artifact.anchors?.includes(anchor)) fail('Anchor is not part of the supplied artifact.');
  const keys = anchor.analysis_keys;
  if (membershipHash(keys) !== anchor.anchor_membership_sha256) fail('Anchor membership hash mismatch.');
  if (keys.length !== anchor.cell_count) fail('Anchor cell count mismatch.');
  const cells = keys.map(key => {
    const i = bundle.keyToIndex.get(key);
    if (i === undefined) fail(`Missing or outside-cleaned-domain analysis_key ${key}.`);
    if (contextId(contextFor(bundle.surface, i, bundle.fixed)) !== anchor.context_id) fail(`Wrong-context analysis_key ${key}.`);
    return i;
  });
  if (JSON.stringify(contextFor(bundle.surface, cells[0], bundle.fixed)) !== JSON.stringify(anchor.context)) fail('Anchor context assertion mismatch.');
  if (components(cells, bundle.graph).length !== 1) fail('Frozen anchor is disconnected.');
  if (anchor.highest_supported_rung !== anchor.rr_anchor_rung || anchor.performance_class !== `P${anchor.highest_supported_rung}`) fail('Anchor rung identity mismatch.');
  return cells;
}

function summary(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = p => { if (!finite.length) return null; const x = (finite.length - 1) * p, lo = Math.floor(x), hi = Math.ceil(x); return lo === hi ? finite[lo] : finite[lo] + (finite[hi] - finite[lo]) * (x - lo); };
  return { count: finite.length, missing: values.length - finite.length, min: q(0), q1: q(0.25), median: q(0.5), q3: q(0.75), max: q(1) };
}

function fraction(values, predicate) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.filter(predicate).length / finite.length : null;
}

function srDecomposition(cells, result, graph) {
  const cellScores = cells.map(i => result.structural_robustness[i]);
  const categories = Object.fromEntries(Object.entries(result.categories).map(([id, values]) => [id, summary(cells.map(i => values[i]))]));
  const directional = Object.fromEntries(graph.info.ordered.map(parameterIndex => {
    const id = graph.info.defs[parameterIndex].id;
    return [id, summary(cells.map(i => result.norm.directional[id][i]))];
  }));
  return {
    structural_robustness: summary(cellScores),
    score_concentration_descriptive_only: {
      fraction_below_0_05: fraction(cellScores, value => value < 0.05),
      fraction_below_0_10: fraction(cellScores, value => value < 0.10)
    },
    categories,
    ordered_dimension_directional_stability: directional,
    neighbor_coverage: summary(cells.map(i => result.raw.coverage[i])),
    normalization_identity: {
      semantic_analysis_version: result.version,
      robust_scale_scope: 'descriptor_hard_regime_over_full_cleaned_domain',
      normalized_component_scope: 'full_cleaned_domain_midranks'
    }
  };
}

function evaluateAnchor(bundle, artifact, anchor, caches = { sr: new Map(), fr: new Map() }) {
  const cells = verifyAnchor(bundle, artifact, anchor), { surface, graph } = bundle;
  const sr = {}, sr_decomposition = {}, fr = {};
  for (const metric of METRICS) {
    if (!caches.sr.has(metric)) caches.sr.set(metric, Semantic.computeSR(surface.metrics[metric], graph));
    sr[metric] = summary(cells.map(i => caches.sr.get(metric).structural_robustness[i]));
    sr_decomposition[metric] = srDecomposition(cells, caches.sr.get(metric), graph);
    if (!caches.fr.has(metric)) caches.fr.set(metric, Semantic.computeFR(surface.metrics[metric], graph));
  }
  for (const facet of graph.info.facets.map(k => graph.info.defs[k].id)) {
    const peerCells = new Set(), perCell = [];
    let applicable = 0, withPeer = 0, expected = 0;
    for (const i of cells) {
      const result = Semantic.matchedFacetPeers(graph, i, facet);
      if (result.status === 'N/A') continue;
      applicable++;
      const peers = result.alternatives.flatMap(alt => alt.peers);
      expected += result.alternatives.reduce((sum, alt) => sum + alt.expected, 0);
      if (peers.length) withPeer++;
      for (const peer of peers) peerCells.add(peer);
      perCell.push(i);
    }
    const peers = [...peerCells];
    fr[facet] = {
      evidence_status: applicable ? (withPeer ? 'SUPPORTED' : 'UNSUPPORTED') : 'N/A',
      applicable_anchor_cells: applicable,
      anchor_cells_with_matched_peer: withPeer,
      expected_peer_relationships: expected,
      unique_matched_peers: peers.length,
      structural_replication: Object.fromEntries(METRICS.map(metric => [metric, {
        similarity: summary(perCell.map(i => caches.fr.get(metric).facetScore[facet][i])),
        peer_coverage: summary(perCell.map(i => caches.fr.get(metric).raw.coverage[facet][i]))
      }])),
      economic_replication: {
        joint_p1_peer_cells: peers.filter(i => surface.supportFields.trades[i] >= 20 && passes(surface, i, 1)).length,
        absolute_metrics: Object.fromEntries(METRICS.map(metric => [metric, summary(peers.map(i => surface.metrics[metric][i]))]))
      }
    };
  }
  const rr = Scan.analyzeFrozenAnchor(surface, graph, cells, METRICS, () => false);
  if (rr.regions.length !== 1 || rr.regions[0].cell_count !== cells.length || rr.definition !== 'frozen_anchor_membership') fail('RR changed frozen anchor membership.');
  return { region_id: anchor.region_id, anchor_membership_sha256: anchor.anchor_membership_sha256, performance_class: anchor.performance_class, sr, sr_decomposition, fr, rr: rr.regions[0] };
}

module.exports = { POLICY_PATH, CLEANED_PATH, METRICS, membershipPreimage, membershipHash, sortedKeys, contextFor, contextId, components, threshold, loadVolumeBands, materializeAnchors, verifyAnchor, evaluateAnchor };
