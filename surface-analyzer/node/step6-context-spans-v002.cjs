'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Frozen = require('./frozen-anchor-v001.cjs');
const VolSpike = require('./volspike-calibration-v001.cjs');

const ROOT = path.join(__dirname, '..');
const REGISTRY = path.join(ROOT, 'registry');
const TRAJECTORY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-trajectory-diagnostic-v001.json');
const OUTPUT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-context-spans-v002.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compareText = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = message => { throw new Error(message); };

function updateInt32LE(hash, label, values) {
  hash.update(`${label}_length=${values.length}\n`, 'utf8');
  const chunkValues = 16384;
  for (let start = 0; start < values.length; start += chunkValues) {
    const length = Math.min(chunkValues, values.length - start), bytes = Buffer.allocUnsafe(length * 4);
    for (let index = 0; index < length; index++) bytes.writeInt32LE(values[start + index], index * 4);
    hash.update(bytes);
  }
}

function topologyHash(bundle) {
  const hash = crypto.createHash('sha256');
  hash.update('semantic_topology_csr_v1\n', 'utf8');
  hash.update(`topology_engine_version=${bundle.graph.version}\n`, 'utf8');
  hash.update(`cells=${bundle.graph.N}\n`, 'utf8');
  hash.update('canonical_analysis_keys_in_graph_index_order\n', 'utf8');
  for (const key of bundle.keysByIndex) {
    if (typeof key !== 'string' || !key || /[\r\n]/.test(key)) fail('Invalid analysis_key in topology preimage.');
    hash.update(`${key}\n`, 'utf8');
  }
  updateInt32LE(hash, 'offsets_int32le', bundle.graph.offsets);
  updateInt32LE(hash, 'neighbors_int32le', bundle.graph.neighbors);
  return hash.digest('hex');
}

function contextSpans(bundle) {
  const orderedIds = bundle.graph.info.ordered.map(index => bundle.graph.info.defs[index].id);
  const groups = new Map();
  for (let cell = 0; cell < bundle.graph.N; cell++) {
    const context = Frozen.contextFor(bundle.surface, cell, bundle.fixed), contextId = Frozen.contextId(context);
    if (!groups.has(contextId)) groups.set(contextId, { context_id: contextId, context, cells: [] });
    groups.get(contextId).cells.push(cell);
  }
  return [...groups.values()].sort((a, b) => compareText(a.context_id, b.context_id)).map(group => {
    const dimensions = {};
    for (const id of orderedIds) {
      const values = group.cells.map(cell => bundle.surface.semanticParameterIndices[id][cell]).filter(index => index >= 0);
      const applicable = values.length > 0;
      const minimum = applicable ? Math.min(...values) : null;
      const maximum = applicable ? Math.max(...values) : null;
      const span = applicable ? maximum - minimum : null;
      dimensions[id] = {
        applicable,
        active_cells: values.length,
        context_cells: group.cells.length,
        full_cleaned_domain_min_index: minimum,
        full_cleaned_domain_max_index: maximum,
        full_cleaned_context_index_span: span,
        singleton: applicable ? span === 0 : false
      };
    }
    return { context_id: group.context_id, context: group.context, cell_count: group.cells.length, ordered_dimensions: dimensions };
  });
}

function caseRecord(calibrationCase, bundle) {
  return {
    calibration_case: calibrationCase,
    cleaned_domain_identity: bundle.bindings.cleaned_domain_identity,
    descriptor_sha256: bundle.bindings.descriptor_sha256,
    topology_engine_version: bundle.graph.version,
    topology_sha256: topologyHash(bundle),
    cleaned_domain_cells: bundle.graph.N,
    contexts: contextSpans(bundle)
  };
}

function buildArtifact(registryRoot = REGISTRY) {
  const trajectoryBytes = fs.readFileSync(TRAJECTORY_PATH), trajectory = JSON.parse(trajectoryBytes);
  if (trajectory.total_unique_envelopes !== 228 || trajectory.total_terminal_structures !== 78) fail('Frozen Step-6 trajectory coverage mismatch.');
  const base = {
    schema_version: 2,
    artifact_type: 'step6_cleaned_context_ordered_spans',
    policy_origin: 'post_result_exploratory',
    authoritative: false,
    derivation: 'cheap_cleaned_domain_scan_only_no_SR_FR_RR_or_envelope_reconstruction',
    source_trajectory_artifact_sha256: sha256(trajectoryBytes),
    topology_hash_preimage: 'semantic_topology_csr_v1; UTF-8 header and canonical analysis_keys in graph-index order; offsets and neighbors encoded signed Int32 little-endian',
    cases: [
      caseRecord('volume_bands', Frozen.loadVolumeBands(registryRoot)),
      caseRecord('volspike', VolSpike.loadVolSpike(registryRoot))
    ]
  };
  const payloadBytes = Buffer.from(`${JSON.stringify(base, null, 2)}\n`, 'utf8');
  return {
    ...base,
    artifact_identity: {
      hash_method: 'sha256_exact_pre_identity_payload_bytes',
      encoding: 'UTF-8',
      bom: false,
      payload_sha256: sha256(payloadBytes)
    }
  };
}

function verifyArtifact(artifact) {
  const { artifact_identity: identity, ...base } = artifact;
  if (!identity || identity.hash_method !== 'sha256_exact_pre_identity_payload_bytes') fail('Context-span artifact identity contract is missing.');
  const payloadBytes = Buffer.from(`${JSON.stringify(base, null, 2)}\n`, 'utf8');
  if (sha256(payloadBytes) !== identity.payload_sha256) fail('Context-span payload identity mismatch.');
  if (artifact.source_trajectory_artifact_sha256 !== sha256(fs.readFileSync(TRAJECTORY_PATH))) fail('Context-span trajectory binding mismatch.');
  if (!Array.isArray(artifact.cases) || artifact.cases.length !== 2) fail('Context-span calibration-case coverage mismatch.');
  for (const item of artifact.cases) {
    if (!item.cleaned_domain_identity || !item.descriptor_sha256 || !item.topology_engine_version || !item.topology_sha256) fail(`${item.calibration_case}: incomplete context-span bindings.`);
    if (!Array.isArray(item.contexts) || !item.contexts.length) fail(`${item.calibration_case}: missing cleaned contexts.`);
    const ids = item.contexts.map(context => context.context_id);
    if (new Set(ids).size !== ids.length || ids.some((id, index) => index && compareText(ids[index - 1], id) >= 0)) fail(`${item.calibration_case}: contexts must be strictly sorted and unique.`);
  }
  return artifact;
}

function main() {
  const artifact = buildArtifact();
  verifyArtifact(artifact);
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_PATH, bytes);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, artifact_sha256: sha256(bytes), payload_sha256: artifact.artifact_identity.payload_sha256, cases: artifact.cases.map(item => ({ calibration_case: item.calibration_case, cells: item.cleaned_domain_cells, contexts: item.contexts.length, topology_sha256: item.topology_sha256 })) }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { topologyHash, contextSpans, caseRecord, buildArtifact, verifyArtifact };
