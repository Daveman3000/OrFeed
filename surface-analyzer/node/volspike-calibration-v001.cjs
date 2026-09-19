'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { unzipSync, strFromU8 } = require('fflate');
const PackageCore = require('../surface-package-core-v001.js');
const Semantic = require('../semantic-analysis-v030.js');
const Frozen = require('./frozen-anchor-v001.cjs');
const { createFilesystemRegistry } = require('./surface-registry-v001.cjs');

const ROOT = path.join(__dirname, '..');
const PHYSICAL_SURFACE_ID = 'volspike_20260911_trades_v1';
const CLEANED_SURFACE_ID = 'volspike_20260911_step3clean_trades_v1';
const PHYSICAL_PACKAGE_SHA256 = 'cb6b753dff4d4f2523f944e291c4b5418401d9d7d818fbc1bfddb7ab0c034c38';
const DESCRIPTOR_SHA256 = 'e2823eecf9b102a0a4b3b453ee2a9371925b5bcdb2950cbfedbec7d5ed9b680c';
const SEMANTIC_CSV_SHA256 = 'f8649bcd04d7ba8618fe489995e0cdcd304b7dabd2444926606bce6739686787';
const SOURCE_PACKAGE_SHA256 = '58834e2326accb4a1a5af72c1da3f04624f22d0b5bc4c9fbdfdec282c81728d5';
const POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'performance-qualification-step4-v001.json');
const CLEANING_POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'domain-cleaning-step3-v001.json');
const SURFACE_POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'volspike-surface-policy-v001.json');
const SCOPES_PATH = path.join(ROOT, 'policies', 'exploratory', 'volspike-step3-prune-scopes-v001.json');
const MANIFEST_PATH = path.join(ROOT, 'policies', 'exploratory', 'volspike-cleaned-domain-step3-v001.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compareKeys = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = message => { throw new Error(message); };

function packageMembers(registryRoot) {
  const registry = createFilesystemRegistry({ registryRoot });
  const record = registry.listSurfaces().find(item => item.surface_id === PHYSICAL_SURFACE_ID);
  if (!record || record.sha256 !== PHYSICAL_PACKAGE_SHA256) fail('Physical VolSpike package identity mismatch.');
  const packagePath = path.join(registryRoot, record.path);
  const bytes = fs.readFileSync(packagePath);
  if (sha256(bytes) !== PHYSICAL_PACKAGE_SHA256) fail('Physical VolSpike package hash mismatch.');
  const members = unzipSync(bytes);
  const descriptorBytes = members['surface_descriptor.json'];
  const csvBytes = members['surface.semantic.csv'];
  if (!descriptorBytes || sha256(descriptorBytes) !== DESCRIPTOR_SHA256) fail('VolSpike descriptor identity mismatch.');
  if (!csvBytes || sha256(csvBytes) !== SEMANTIC_CSV_SHA256) fail('VolSpike semantic CSV identity mismatch.');
  const descriptor = JSON.parse(strFromU8(descriptorBytes));
  const trades = descriptor.results?.support_fields;
  if (JSON.stringify(trades) !== JSON.stringify([{ id: 'trades', type: 'integer', role: 'sample_support' }])) fail('Canonical typed trades declaration is missing.');
  if ((descriptor.results.passthrough_results || []).includes('trades')) fail('trades must not remain a passthrough result.');
  return { registry, record, packagePath, bytes, descriptorBytes, csvBytes, descriptor };
}

function assertSurfacePolicy(descriptor) {
  const bytes = fs.readFileSync(SURFACE_POLICY_PATH), policy = JSON.parse(bytes);
  if (policy.policy_origin !== 'post_result_exploratory') fail('VolSpike surface policy provenance mismatch.');
  if (policy.descriptor_binding?.descriptor_sha256 !== DESCRIPTOR_SHA256) fail('VolSpike surface policy descriptor binding mismatch.');
  const byId = Object.fromEntries(descriptor.parameters.map(parameter => [parameter.id, parameter]));
  if (Object.keys(policy.descriptor_assertions).length !== descriptor.parameters.length) fail('VolSpike descriptor assertion coverage mismatch.');
  for (const [id, assertion] of Object.entries(policy.descriptor_assertions)) {
    const parameter = byId[id];
    if (!parameter || assertion.topology_role !== parameter.topology_role || assertion.source !== parameter.source || JSON.stringify(assertion.active_when) !== JSON.stringify(parameter.active_when)) fail(`${id}: descriptor assertion mismatch.`);
  }
  return { policy, bytes, hash: sha256(bytes) };
}

function scopeKey(surface, index, ids) {
  return ids.map(id => surface.semanticParameterIndices[id][index]).join(',');
}

function keysByCanonicalIndex(csvText, descriptor, surface) {
  const params = descriptor.parameters;
  const maps = params.map(parameter => new Map((parameter.values || parameter.ordered_values).map((value, index) => [String(value), index])));
  const byTuple = new Map();
  let header = null;
  PackageCore.eachCsvRow(csvText, row => {
    if (!header) { header = Object.fromEntries(row.map((name, index) => [name.trim(), index])); return; }
    if (row.every(value => value === '')) return;
    const tuple = params.map((parameter, parameterIndex) => {
      const raw = row[header[parameter.id]];
      if (raw === '') return -1;
      const valueIndex = maps[parameterIndex].get(raw);
      if (valueIndex === undefined) fail(`${parameter.id}: CSV value is outside the descriptor domain.`);
      return valueIndex;
    }).join(',');
    const key = row[header.analysis_key];
    if (!key || byTuple.has(tuple)) fail('Missing analysis_key or duplicate semantic coordinate.');
    byTuple.set(tuple, key);
  });
  const keys = new Array(surface.rows * surface.cols), seen = new Set();
  for (let index = 0; index < keys.length; index++) {
    const tuple = params.map(parameter => surface.semanticParameterIndices[parameter.id][index]).join(',');
    const key = byTuple.get(tuple);
    if (!key || seen.has(key)) fail('Canonical package-to-analysis_key mapping is incomplete or duplicated.');
    seen.add(key); keys[index] = key;
  }
  if (seen.size !== 56000) fail('Physical package must contain exactly 56,000 unique analysis_keys.');
  return keys;
}

function filterSurface(source, retained) {
  const metrics = Object.fromEntries(Object.entries(source.metrics).map(([id, values]) => [id, Float64Array.from(retained, index => values[index])]));
  const supportFields = Object.fromEntries(Object.entries(source.supportFields).map(([id, values]) => [id, Int32Array.from(retained, index => values[index])]));
  const semanticParameterIndices = Object.fromEntries(Object.entries(source.semanticParameterIndices).map(([id, values]) => [id, Int16Array.from(retained, index => values[index])]));
  return {
    ...source,
    rows: retained.length,
    cols: 1,
    metrics,
    supportFields,
    semanticParameterIndices,
    semanticAxis: { x: [], y: [] },
    researchSurfaceId: CLEANED_SURFACE_ID
  };
}

function assertUniqueRetainedKeys(keys, expected = 41195) {
  if (!Array.isArray(keys) || keys.length !== expected || keys.some(key => typeof key !== 'string' || !key) || new Set(keys).size !== expected) fail('Cleaned domain contains duplicate or missing retained keys.');
  return keys;
}

function deriveCleanedBundle(registryRoot) {
  const packageData = packageMembers(registryRoot);
  const source = packageData.registry.resolveSurface(PHYSICAL_SURFACE_ID);
  if (source.rows * source.cols !== 56000) fail('Physical VolSpike package must contain 56,000 cells.');
  if (!(source.supportFields.trades instanceof Int32Array)) fail('VolSpike trades support must materialize as Int32Array.');
  const surfacePolicy = assertSurfacePolicy(packageData.descriptor);
  const cleaningPolicyBytes = fs.readFileSync(CLEANING_POLICY_PATH);
  const cleaningPolicy = JSON.parse(cleaningPolicyBytes);
  if (cleaningPolicy.frozen !== true || cleaningPolicy.policy_origin !== 'post_result_exploratory') fail('Frozen exploratory Step-3 policy is required.');
  const scopesBytes = fs.readFileSync(SCOPES_PATH), scopesArtifact = JSON.parse(scopesBytes);
  if (scopesArtifact.source_package_sha256 !== SOURCE_PACKAGE_SHA256 || scopesArtifact.cleaning_policy_sha256 !== sha256(cleaningPolicyBytes)) fail('Step-3 scope source or policy identity mismatch.');
  const scopes = scopesArtifact.scopes;
  if (!Array.isArray(scopes) || scopes.length !== 91 || new Set(scopes).size !== 91) fail('Exactly 91 unique Step-3 prune scopes are required.');
  const sortedScopes = [...scopes].sort(compareKeys);
  if (sha256(Buffer.from(`${sortedScopes.join('\n')}\n`, 'utf8')) !== scopesArtifact.scope_list_sha256) fail('Step-3 scope-list hash mismatch.');
  const scopeSet = new Set(scopes), removed = [], retained = [];
  for (let index = 0; index < 56000; index++) (scopeSet.has(scopeKey(source, index, scopesArtifact.scope_key_parameters)) ? removed : retained).push(index);
  if (removed.length !== 14805 || retained.length !== 41195) fail('Step-3 cleaned-domain cell counts do not match the approved result.');
  const tailContext = '0,0,1,0,0,1,1', tail = [];
  for (let index = 0; index < 56000; index++) if (scopeKey(source, index, scopesArtifact.scope_key_parameters) === tailContext && source.semanticParameterIndices.fixed_target_london_range_multiple[index] === 4) tail.push(index);
  if (tail.length !== 35 || tail.some(index => scopeSet.has(scopeKey(source, index, scopesArtifact.scope_key_parameters)))) fail('Known 35-cell tail removal invariant failed.');
  const sourceKeys = keysByCanonicalIndex(strFromU8(packageData.csvBytes), packageData.descriptor, source);
  const keysByIndex = retained.map(index => sourceKeys[index]);
  assertUniqueRetainedKeys(keysByIndex);
  const sortedRetainedKeys = [...keysByIndex].sort(compareKeys);
  const retainedKeysSha256 = Frozen.membershipHash(sortedRetainedKeys);
  const scopeArtifactSha256 = sha256(scopesBytes);
  const identityLines = [
    'cleaned_research_surface_identity_v1',
    `cleaned_surface_id=${CLEANED_SURFACE_ID}`,
    `physical_surface_id=${PHYSICAL_SURFACE_ID}`,
    `physical_package_sha256=${PHYSICAL_PACKAGE_SHA256}`,
    `descriptor_sha256=${DESCRIPTOR_SHA256}`,
    `surface_policy_sha256=${surfacePolicy.hash}`,
    `cleaning_policy_sha256=${sha256(cleaningPolicyBytes)}`,
    `scope_artifact_sha256=${scopeArtifactSha256}`,
    `scope_list_sha256=${scopesArtifact.scope_list_sha256}`,
    'source_count=56000',
    'excluded_count=14805',
    'retained_count=41195',
    `retained_analysis_keys_sha256=${retainedKeysSha256}`,
    ''
  ];
  const cleanedDomainIdentity = sha256(Buffer.from(identityLines.join('\n'), 'utf8'));
  const surface = filterSurface(source, retained);
  const graph = Semantic.buildTopology(surface);
  if (graph.N !== 41195) fail('Filtered semantic graph must contain exactly 41,195 cells.');
  const keyToIndex = new Map(keysByIndex.map((key, index) => [key, index]));
  const fixed = packageData.descriptor.parameters.filter(parameter => parameter.topology_role === 'regime' || parameter.topology_role === 'facet');
  const step4PolicyBytes = fs.readFileSync(POLICY_PATH), step4Policy = JSON.parse(step4PolicyBytes);
  if (step4Policy.frozen !== true || step4Policy.authoritative !== false) fail('Frozen exploratory Step-4 policy is required.');
  return {
    source, surface, graph, fixed, keysByIndex, keyToIndex, removed, retained, tail,
    physicalCellCount: 56000,
    physicalIndexByCell: Int32Array.from(retained),
    physicalKeysByIndex: sourceKeys,
    packageData, surfacePolicy, cleaningPolicy, cleaningPolicyBytes, scopesArtifact, scopesBytes,
    cleanedDomainIdentity, retainedKeysSha256, identityLines,
    manifest: { campaign_id: 'volspike_20260911_step3clean_calibration' },
    policy: step4Policy,
    bindings: {
      surface_id: CLEANED_SURFACE_ID,
      storage_surface_id: PHYSICAL_SURFACE_ID,
      package_sha256: PHYSICAL_PACKAGE_SHA256,
      descriptor_sha256: DESCRIPTOR_SHA256,
      surface_policy_sha256: surfacePolicy.hash,
      cleaning_policy_sha256: sha256(cleaningPolicyBytes),
      scope_list_sha256: scopesArtifact.scope_list_sha256,
      cleaned_domain_identity: cleanedDomainIdentity,
      step4_policy_id: step4Policy.policy_id,
      step4_policy_version: step4Policy.policy_version,
      step4_policy_sha256: sha256(step4PolicyBytes),
      topology_engine_version: graph.version
    }
  };
}

function buildCleanedManifest(bundle) {
  return {
    schema_version: 1,
    artifact_type: 'cleaned_domain_manifest',
    artifact_version: '1',
    policy_origin: 'post_result_exploratory',
    campaign_id: bundle.manifest.campaign_id,
    cleaned_surface_id: CLEANED_SURFACE_ID,
    storage_surface: {
      surface_id: PHYSICAL_SURFACE_ID,
      package_sha256: PHYSICAL_PACKAGE_SHA256,
      descriptor_sha256: DESCRIPTOR_SHA256,
      semantic_csv_sha256: SEMANTIC_CSV_SHA256,
      original_source_package_sha256: SOURCE_PACKAGE_SHA256,
      source_cells: 56000,
      representation_change: 'trades declared as canonical typed Int32 sample support; semantic CSV bytes unchanged'
    },
    surface_policy: { path: 'surface-analyzer/policies/exploratory/volspike-surface-policy-v001.json', sha256_exact_file_bytes: bundle.surfacePolicy.hash },
    cleaning_policy: { path: 'surface-analyzer/policies/exploratory/domain-cleaning-step3-v001.json', sha256_exact_file_bytes: sha256(bundle.cleaningPolicyBytes) },
    prune_scopes: {
      path: 'surface-analyzer/policies/exploratory/volspike-step3-prune-scopes-v001.json',
      sha256_exact_file_bytes: sha256(bundle.scopesBytes),
      scope_count: 91,
      scope_list_sha256: bundle.scopesArtifact.scope_list_sha256
    },
    outcome_summary: { source_cells: 56000, removed_cells: 14805, retained_cells: 41195, known_35_cell_tail_removed: 0 },
    cleaned_domain_identity: {
      hash_method: 'sha256_utf8_identity_preimage',
      retained_analysis_keys_hash_method: 'sha256_utf8_lf_sorted_analysis_keys_with_final_lf',
      retained_analysis_keys_sha256: bundle.retainedKeysSha256,
      identity_preimage_lines: bundle.identityLines,
      cleaned_domain_sha256: bundle.cleanedDomainIdentity
    },
    graph_contract: {
      input: 'filter physical package by exact retained analysis_key membership before topology construction',
      cells: bundle.graph.N,
      topology_engine_version: bundle.graph.version,
      no_bridging_removed_intermediate_values: true
    }
  };
}

function verifyManifest(bundle, manifest) {
  if (manifest.cleaned_surface_id !== CLEANED_SURFACE_ID) fail('Cleaned surface identity mismatch.');
  if (manifest.storage_surface?.package_sha256 !== PHYSICAL_PACKAGE_SHA256 || manifest.storage_surface?.descriptor_sha256 !== DESCRIPTOR_SHA256 || manifest.storage_surface?.semantic_csv_sha256 !== SEMANTIC_CSV_SHA256 || manifest.storage_surface?.original_source_package_sha256 !== SOURCE_PACKAGE_SHA256) fail('Cleaned manifest storage binding mismatch.');
  if (manifest.surface_policy?.sha256_exact_file_bytes !== bundle.surfacePolicy.hash || manifest.cleaning_policy?.sha256_exact_file_bytes !== sha256(bundle.cleaningPolicyBytes)) fail('Cleaned manifest policy binding mismatch.');
  if (manifest.prune_scopes?.scope_list_sha256 !== bundle.scopesArtifact.scope_list_sha256) fail('Cleaned manifest scope-list binding mismatch.');
  if (manifest.outcome_summary?.source_cells !== 56000 || manifest.outcome_summary?.removed_cells !== 14805 || manifest.outcome_summary?.retained_cells !== 41195 || manifest.outcome_summary?.known_35_cell_tail_removed !== 0) fail('Cleaned manifest count or tail invariant mismatch.');
  if (manifest.cleaned_domain_identity?.retained_analysis_keys_sha256 !== bundle.retainedKeysSha256 || manifest.cleaned_domain_identity?.cleaned_domain_sha256 !== bundle.cleanedDomainIdentity) fail('Cleaned manifest domain identity mismatch.');
  if (sha256(Buffer.from(manifest.cleaned_domain_identity.identity_preimage_lines.join('\n'), 'utf8')) !== bundle.cleanedDomainIdentity) fail('Cleaned manifest identity preimage mismatch.');
  if (manifest.graph_contract?.cells !== 41195 || manifest.graph_contract?.topology_engine_version !== bundle.graph.version || manifest.graph_contract?.no_bridging_removed_intermediate_values !== true) fail('Cleaned manifest graph binding mismatch.');
  return bundle;
}

function loadVolSpike(registryRoot) {
  const bundle = deriveCleanedBundle(registryRoot);
  if (!fs.existsSync(MANIFEST_PATH)) fail('Materialized VolSpike cleaned-domain manifest is missing.');
  return verifyManifest(bundle, JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')));
}

module.exports = {
  PHYSICAL_SURFACE_ID, CLEANED_SURFACE_ID, PHYSICAL_PACKAGE_SHA256, DESCRIPTOR_SHA256, SEMANTIC_CSV_SHA256,
  POLICY_PATH, CLEANING_POLICY_PATH, SURFACE_POLICY_PATH, SCOPES_PATH, MANIFEST_PATH,
  assertUniqueRetainedKeys, deriveCleanedBundle, buildCleanedManifest, verifyManifest, loadVolSpike
};
