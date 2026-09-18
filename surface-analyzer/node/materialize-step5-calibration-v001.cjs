'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Frozen = require('./frozen-anchor-v001.cjs');
const VolSpike = require('./volspike-calibration-v001.cjs');

const ROOT = path.join(__dirname, '..');
const REGISTRY = path.join(ROOT, 'registry');
const SCHEMA_PATH = path.join(ROOT, 'policies', 'exploratory', 'step5-robustness-evidence-schema-v001.json');
const VB_ANCHORS_PATH = path.join(ROOT, 'policies', 'exploratory', 'volume-bands-step4-frozen-anchors-v001.json');
const VB_EVIDENCE_PATH = path.join(ROOT, 'policies', 'exploratory', 'volume-bands-step5-anchor-evidence-v002.json');
const VS_ANCHORS_PATH = path.join(ROOT, 'policies', 'exploratory', 'volspike-step4-frozen-anchors-v001.json');
const VS_EVIDENCE_PATH = path.join(ROOT, 'policies', 'exploratory', 'volspike-step5-anchor-evidence-v001.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function evidenceArtifact(bundle, anchorArtifact, anchorBytes, schemaHash) {
  const caches = { sr: new Map(), fr: new Map() };
  return {
    schema_version: 2,
    artifact_type: 'step5_exact_anchor_evidence',
    policy_origin: 'post_result_exploratory',
    evidence_schema_id: 'step5-robustness-evidence-schema-v001',
    evidence_schema_sha256: schemaHash,
    anchor_artifact_sha256: sha256(anchorBytes),
    bindings: anchorArtifact.bindings,
    metrics: Frozen.METRICS,
    interpretation: 'descriptive_only_no_robustness_thresholds_or_labels',
    results: anchorArtifact.anchors.map(anchor => Frozen.evaluateAnchor(bundle, anchorArtifact, anchor, caches))
  };
}

function main() {
  const schemaHash = sha256(fs.readFileSync(SCHEMA_PATH));
  const vbBundle = Frozen.loadVolumeBands(REGISTRY);
  const vbAnchorBytes = fs.readFileSync(VB_ANCHORS_PATH);
  const vbAnchors = JSON.parse(vbAnchorBytes);
  writeJson(VB_EVIDENCE_PATH, evidenceArtifact(vbBundle, vbAnchors, vbAnchorBytes, schemaHash));

  const vsBundle = VolSpike.loadVolSpike(REGISTRY);
  const vsAnchors = Frozen.materializeAnchors(vsBundle, { regionPrefix: 'VS' });
  const vsAnchorBytes = Buffer.from(`${JSON.stringify(vsAnchors, null, 2)}\n`, 'utf8');
  fs.writeFileSync(VS_ANCHORS_PATH, vsAnchorBytes);
  writeJson(VS_EVIDENCE_PATH, evidenceArtifact(vsBundle, vsAnchors, vsAnchorBytes, schemaHash));

  process.stdout.write(`${JSON.stringify({
    evidence_schema_sha256: schemaHash,
    volume_bands: { anchors: vbAnchors.anchors.length, evidence_path: VB_EVIDENCE_PATH },
    volspike: {
      anchors: vsAnchors.anchors.length,
      anchor_cells: vsAnchors.anchors.reduce((sum, anchor) => sum + anchor.cell_count, 0),
      anchor_path: VS_ANCHORS_PATH,
      evidence_path: VS_EVIDENCE_PATH
    }
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { evidenceArtifact };
