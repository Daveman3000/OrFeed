'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Frozen = require('./frozen-anchor-v001.cjs');
const VolSpike = require('./volspike-calibration-v001.cjs');

const ROOT = path.join(__dirname, '..');
const REGISTRY = path.join(ROOT, 'registry');
const TRAJECTORY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-trajectory-diagnostic-v001.json');
const CONTEXT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-context-spans-v002.json');
const ANCHOR_PATH = path.join(ROOT, 'policies', 'exploratory', 'volspike-step4-frozen-anchors-v002.json');
const OUTPUT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-performance-distribution-companion-v003.json');
const METRICS = ['r_per_trade', 'profit_factor', 'romad'];
const EXPECTED = {
  trajectory: '5787f702f4730d5a4c43e398207f9ce354ee0b51620d0f9ae6e3e9aec7166ec9',
  contexts: 'fc44a6332f30bd329dfd9a776abe5aeaa59b146c498a82bb16f242379ca0e900',
  anchors: '9f6761613a3076d15ac2c835ea151b949567eb4a1fe8c2194ebce90ea5749401'
};
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw new Error(message); };
const compareText = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

function readBound(pathname, expected, label) {
  const bytes = fs.readFileSync(pathname);
  if (sha256(bytes) !== expected) fail(`${label} exact-byte identity mismatch.`);
  return { bytes, value: JSON.parse(bytes) };
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const x = (sorted.length - 1) * q;
  const lo = Math.floor(x), hi = Math.ceil(x);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (x - lo);
}

function maskHas(bytes, physicalIndex) { return Boolean(bytes[physicalIndex >> 3] & (1 << (physicalIndex & 7))); }

function buildArtifact() {
  const trajectoryBound = readBound(TRAJECTORY_PATH, EXPECTED.trajectory, 'Trajectory artifact');
  const contextBound = readBound(CONTEXT_PATH, EXPECTED.contexts, 'Context-span artifact');
  const anchorBound = readBound(ANCHOR_PATH, EXPECTED.anchors, 'VolSpike v2 anchor artifact');
  const trajectoryCase = trajectoryBound.value.cases.find(item => item.calibration_case === 'volspike');
  const contextCase = contextBound.value.cases.find(item => item.calibration_case === 'volspike');
  if (!trajectoryCase || !contextCase) fail('VolSpike source case is missing.');
  const missing = Object.values(trajectoryCase.envelopes)
    .filter(envelope => !envelope.distributed_sample?.metrics)
    .sort((a, b) => compareText(a.membership_sha256, b.membership_sha256));
  if (missing.length !== 50) fail(`Expected 50 missing VolSpike distributions, found ${missing.length}.`);

  const bundle = VolSpike.loadVolSpike(REGISTRY);
  if (bundle.cleanedDomainIdentity !== contextCase.cleaned_domain_identity) fail('Cleaned-domain identity mismatch.');
  if (bundle.bindings.descriptor_sha256 !== contextCase.descriptor_sha256 || bundle.graph.version !== contextCase.topology_engine_version) fail('Descriptor/topology binding mismatch.');
  const membershipBundle = anchorBound.value.membership_bundle;
  const maskPath = path.join(ROOT, '..', membershipBundle.path);
  const maskBytes = fs.readFileSync(maskPath);
  if (sha256(maskBytes) !== membershipBundle.sha256) fail('VolSpike membership-bundle identity mismatch.');
  const records = new Map(membershipBundle.regions.map(item => [item.membership_sha256, item]));

  const envelopes = {};
  for (const envelope of missing) {
    const record = records.get(envelope.membership_sha256);
    if (!record || record.cell_count !== envelope.cell_count) fail(`${envelope.membership_sha256}: frozen mask record mismatch.`);
    const bytes = maskBytes.subarray(record.offset_bytes, record.offset_bytes + record.length_bytes);
    const cells = [];
    for (let cleanedIndex = 0; cleanedIndex < bundle.graph.N; cleanedIndex++) if (maskHas(bytes, bundle.physicalIndexByCell[cleanedIndex])) cells.push(cleanedIndex);
    if (cells.length !== envelope.cell_count) fail(`${envelope.membership_sha256}: frozen mask cell count mismatch.`);
    const keys = Frozen.sortedKeys(cells.map(index => bundle.keysByIndex[index]));
    if (Frozen.membershipHash(keys) !== envelope.membership_sha256) fail(`${envelope.membership_sha256}: reconstructed membership hash mismatch.`);
    envelopes[envelope.membership_sha256] = {
      membership_sha256: envelope.membership_sha256,
      rung: envelope.rung,
      cell_count: envelope.cell_count,
      metrics: Object.fromEntries(METRICS.map(metric => {
        const values = cells.map(index => bundle.surface.metrics[metric][index]).filter(Number.isFinite).sort((a, b) => a - b);
        if (values.length !== cells.length) fail(`${envelope.membership_sha256}: ${metric} contains nonfinite values.`);
        return [metric, { q25: quantile(values, 0.25), median: quantile(values, 0.5) }];
      }))
    };
  }

  const payload = {
    artifact_type: 'step6_v003_performance_distribution_companion',
    calibration_case: 'volspike',
    cleaned_domain_identity: contextCase.cleaned_domain_identity,
    descriptor_sha256: contextCase.descriptor_sha256,
    topology_engine_version: contextCase.topology_engine_version,
    topology_sha256: contextCase.topology_sha256,
    source_trajectory_sha256: EXPECTED.trajectory,
    source_anchor_v2_sha256: EXPECTED.anchors,
    source_membership_bundle_sha256: membershipBundle.sha256,
    quantile_definition: 'linear interpolation on sorted finite values at index (n-1)q; q25=0.25; median=0.50',
    metrics: METRICS,
    envelope_count: missing.length,
    envelopes
  };
  const payloadBytes = Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8');
  return {
    schema_version: 1,
    artifact_type: payload.artifact_type,
    policy_origin: 'post_result_exploratory',
    authoritative: false,
    scope: 'v003_missing_performance_distributions_only',
    payload_sha256: sha256(payloadBytes),
    ...payload
  };
}

function main() {
  const artifact = buildArtifact();
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_PATH, bytes);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, artifact_sha256: sha256(bytes), payload_sha256: artifact.payload_sha256, envelope_count: artifact.envelope_count }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { quantile, buildArtifact };
