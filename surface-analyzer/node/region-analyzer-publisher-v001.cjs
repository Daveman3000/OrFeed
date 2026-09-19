'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ASSET_ROOT = path.join(ROOT, 'region-analyzer');
const VERSION_ROOT = path.join(ASSET_ROOT, 'versions');
const BUNDLE_ROOT = path.join(ASSET_ROOT, 'bundles');
const CATALOG_PATH = path.join(ASSET_ROOT, 'catalog.json');
const TARGET_SURFACE_ID = 'volbands_20260918_bandtp_shoulder_winpct_v1';
const VERSION_ID = `${TARGET_SURFACE_ID}-region-analyzer-v002`;
const PHYSICAL_CELLS = 311150;
const BYTES_PER_MASK = Math.ceil(PHYSICAL_CELLS / 8);
const PREMATERIALIZED_BUNDLE_SHA256 = '43e340093e24d28d3b803ecf5094ce0ecae08f17d47b7e026d8a29f21dbdbc28';
const CANONICAL_PHYSICAL_ORDER_SHA256 = '4fa9fccb21d7895368d93832239081eef291a336eeade9ed6a457f5056d979c6';
const PREMATERIALIZED_BUNDLE_PATH = path.join(BUNDLE_ROOT, `${PREMATERIALIZED_BUNDLE_SHA256}.masks.bin`);

const SOURCES = {
  cleaned_domain: path.join(ROOT, 'policies', 'exploratory', 'volume-bands-cleaned-domain-step3-v001.json'),
  step4_anchors: path.join(ROOT, 'policies', 'exploratory', 'volume-bands-step4-frozen-anchors-v001.json'),
  step5_evidence: path.join(ROOT, 'policies', 'exploratory', 'volume-bands-step5-anchor-evidence-v002.json'),
  step5_joint: path.join(ROOT, 'policies', 'exploratory', 'step5-joint-calibration-v001.json'),
  step5_policy: path.join(ROOT, 'policies', 'exploratory', 'step5-robustness-adjudication-v001.json'),
  step6_trajectory: path.join(ROOT, 'policies', 'exploratory', 'step6-trajectory-diagnostic-v001.json'),
  step6_v1_policy: path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-selection-v001.json'),
  step6_v1_result: path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-selection-result-v001.json'),
  step6_v2_policy: path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-ranking-v002.json'),
  step6_v2_result: path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-ranking-result-v002.json'),
  step6_context_spans: path.join(ROOT, 'policies', 'exploratory', 'step6-context-spans-v002.json'),
  step6_v3_policy: path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-calibration-v003.json'),
  step6_v3_result: path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-calibration-result-v003.json'),
  step6_v4_policy: path.join(ROOT, 'policies', 'exploratory', 'step6-ranking-calibration-v004.json'),
  step6_v4_result: path.join(ROOT, 'policies', 'exploratory', 'step6-ranking-calibration-result-v004.json')
};

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compareText = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = message => { throw new Error(message); };
const regionId = membership => `region-${membership}`;

function readJson(file) {
  const bytes = fs.readFileSync(file);
  return { bytes, sha256: sha256(bytes), value: JSON.parse(bytes) };
}

function popcount(bytes) {
  let count = 0;
  for (const byte of bytes) {
    let value = byte;
    while (value) { value &= value - 1; count++; }
  }
  return count;
}

function assertZeroPadding(bytes, physicalCells = PHYSICAL_CELLS) {
  const excess = bytes.length * 8 - physicalCells;
  if (excess < 0 || excess > 7) fail('Mask length does not match its physical index space.');
  if (excess) {
    const validBits = 8 - excess, invalidMask = (0xff << validBits) & 0xff;
    if (bytes[bytes.length - 1] & invalidMask) fail('Mask final-byte padding is not zero.');
  }
  return true;
}

function assertBitsetSubset(regionBytes, domainBytes) {
  if (regionBytes.length !== domainBytes.length) fail('Region and cleaned-domain bitsets have different physical index spaces.');
  for (let index = 0; index < regionBytes.length; index++) if (regionBytes[index] & (~domainBytes[index] & 0xff)) fail('Region mask is not a subset of the cleaned-domain mask.');
  return true;
}

function relationMap(trajectoryCase) {
  const relations = new Map(Object.keys(trajectoryCase.envelopes).map(hash => [hash, { parents: new Set(), children: new Set(), descendants: new Set() }]));
  const lineages = trajectoryCase.trajectories.map(trajectory => {
    const hashes = trajectory.performance_led.envelope_membership_sha256;
    hashes.forEach(hash => relations.get(hash).descendants.add(trajectory.terminal_region_id));
    for (let index = 1; index < hashes.length; index++) {
      relations.get(hashes[index - 1]).children.add(hashes[index]);
      relations.get(hashes[index]).parents.add(hashes[index - 1]);
    }
    return { terminal_region_id: trajectory.terminal_region_id, terminal_performance_class: trajectory.terminal_performance_class, stage4_region_ids: hashes.map(regionId) };
  });
  return { relations, lineages };
}

function stage5Annotations(trajectoryCase, dedicated, joint, sourceHashes) {
  const dedicatedByHash = new Map(dedicated.results.map(result => [result.anchor_membership_sha256, result]));
  const membershipByDedicatedRegion = new Map(dedicated.results.map(result => [result.region_id, result.anchor_membership_sha256]));
  const jointCase = joint.cases.find(item => item.calibration_case === 'volume_bands');
  if (!jointCase) fail('Volume Bands Step-5 adjudication case is missing.');
  const jointByHash = new Map(jointCase.results.map(result => [membershipByDedicatedRegion.get(result.region_id), result]));
  return Object.fromEntries(Object.entries(trajectoryCase.envelopes).sort(([a], [b]) => compareText(a, b)).map(([membership, envelope]) => {
    const exact = dedicatedByHash.get(membership), adjudicated = jointByHash.get(membership);
    if (exact) {
      if (!adjudicated) fail(`${membership}: dedicated terminal evidence lacks Step-5 adjudication.`);
      return [regionId(membership), {
        region_id: regionId(membership), membership_hash: membership,
        evidence_authority: 'DEDICATED_FROZEN_STEP5_TERMINAL_EVIDENCE',
        evidence_source_artifacts: [{ id: 'volume-bands-step5-anchor-evidence-v002', sha256: sourceHashes.step5_evidence }, { id: 'step5-joint-calibration-v001', sha256: sourceHashes.step5_joint }],
        profile: adjudicated.profile, sr: exact.sr, sr_decomposition: exact.sr_decomposition, rr: exact.rr, fr: exact.fr,
        boundary_conditioning: adjudicated.boundary_conditioning,
        support: { cell_count: exact.rr.cell_count, lineage: adjudicated.lineage }
      }];
    }
    return [regionId(membership), {
      region_id: regionId(membership), membership_hash: membership,
      evidence_authority: 'STORED_STEP6_TRAJECTORY_NONTERMINAL_EVIDENCE',
      evidence_source_artifacts: [{ id: 'step6-trajectory-diagnostic-v001', sha256: sourceHashes.step6_trajectory }],
      profile: null, profile_status: 'NOT_STORED_IN_SOURCE_TRAJECTORY_ARTIFACT', sr: envelope.sr, sr_decomposition: null,
      sr_decomposition_status: 'NOT_STORED_IN_SOURCE_TRAJECTORY_ARTIFACT', rr: envelope.rr, fr: envelope.fr,
      boundary_conditioning: null,
      support: { cell_count: envelope.cell_count, observed_failure_signals: envelope.observed_failure_signals }
    }];
  }));
}

function rankingRun(run) {
  const weights = run.ranking[0]?.components?.weights || {};
  return {
    weight_id: run.weight_id,
    performance_weight: weights.performance ?? null,
    stability_weight: weights.stability ?? null,
    ranking: run.ranking.map(item => ({ region_id: regionId(item.membership_sha256), rank: item.rank, score: item.score }))
  };
}

function topThreeSummary(runs) {
  const sets = runs.map(run => new Set(run.ranking.filter(item => item.rank <= 3).map(item => item.region_id)));
  const union = [...new Set(sets.flatMap(set => [...set]))].sort(compareText);
  const stableIntersection = sets.length ? [...sets[0]].filter(id => sets.every(set => set.has(id))).sort(compareText) : [];
  return {
    stable_intersection: stableIntersection,
    union,
    identical_across_weights: sets.every(set => set.size === sets[0].size && [...set].every(id => sets[0].has(id)))
  };
}

function stage6Data(v3Case, v4Case) {
  const labels = { strict: 'Low', center: 'Mid', loose: 'High' };
  const order = ['strict', 'center', 'loose'];
  const candidateAnnotations = {};
  const tolerances = {};
  for (const gridId of order) {
    const v3Grid = v3Case.grids.find(item => item.grid_id === gridId);
    const v4Grid = v4Case.grids.find(item => item.grid_id === gridId);
    if (!v3Grid || !v4Grid) fail(`Stage-6 ${gridId} grid is missing.`);
    const modes = {};
    for (const [mode, role] of [['performance', 'performance_led'], ['stability', 'stability_led']]) {
      const v3Hashes = v3Grid.roles[role].exact_membership_candidates.map(item => item.membership_sha256);
      const source = v4Grid.roles[role];
      if (JSON.stringify(v3Hashes) !== JSON.stringify(source.candidate_membership_sha256_in_v003_order)) fail(`Stage-6 ${gridId}/${role} v003/v004 candidate identity mismatch.`);
      const runs = source.ranking_runs.map(rankingRun);
      const componentsByHash = new Map((source.ranking_runs[0]?.ranking || []).map(item => [item.membership_sha256, item.components]));
      for (const membership of v3Hashes) {
        const id = regionId(membership), components = componentsByHash.get(membership) || {};
        if (!candidateAnnotations[id]) candidateAnnotations[id] = {
          region_id: id,
          membership_hash: membership,
          performance_score: components.performance_score ?? null,
          breadth_score: components.breadth_score_diagnostic_only ?? null,
          stability_score: components.stability_score ?? null,
          tractability_status: 'UNASSESSED',
          selected_in: []
        };
        candidateAnnotations[id].selected_in.push({ grid_id: gridId, tolerance: labels[gridId], mode });
      }
      modes[mode] = {
        candidate_count: v3Hashes.length,
        candidates: v3Hashes.map(regionId),
        runs,
        ...topThreeSummary(runs)
      };
    }
    tolerances[gridId] = { grid_id: gridId, label: labels[gridId], modes };
  }
  return {
    ranking_status: 'calibration',
    stopping_status: 'calibration',
    tolerance_policy_frozen: false,
    center_weights_frozen: false,
    shortlist_frozen: false,
    default_tolerance: 'center',
    default_mode: 'performance',
    tolerance_order: order,
    tolerances,
    candidate_annotations: candidateAnnotations
  };
}

function validateSourceBindings(source) {
  const cleaned = source.cleaned_domain.value, anchors = source.step4_anchors.value;
  if (cleaned.source_surface.surface_id !== TARGET_SURFACE_ID || anchors.bindings.surface_id !== TARGET_SURFACE_ID) fail('Publisher sources are bound to the wrong surface.');
  if (cleaned.source_surface.source_cells !== PHYSICAL_CELLS || cleaned.outcome_summary.retained_cells !== PHYSICAL_CELLS || cleaned.outcome_summary.removed_cells !== 0) fail('Publisher requires the recorded all-retained 311,150-cell domain.');
  for (const id of ['package_sha256', 'descriptor_sha256']) if (anchors.bindings[id] !== cleaned.source_surface[id]) fail(`${id}: Step-3/Step-4 binding mismatch.`);
  if (anchors.bindings.cleaned_domain_identity !== cleaned.cleaned_domain_identity.cleaned_domain_sha256) fail('Cleaned-domain identity mismatch.');
  return { cleaned, anchors };
}

function buildPublication() {
  const source = Object.fromEntries(Object.entries(SOURCES).map(([id, file]) => [id, readJson(file)]));
  const sourceHashes = Object.fromEntries(Object.entries(source).map(([id, item]) => [id, item.sha256]));
  const { anchors } = validateSourceBindings(source);
  const trajectoryCase = source.step6_trajectory.value.cases.find(item => item.calibration_case === 'volume_bands');
  if (!trajectoryCase || trajectoryCase.unique_envelopes !== 55) fail('Expected exactly 55 Volume Bands Stage-4 envelopes.');
  const regionHashes = Object.keys(trajectoryCase.envelopes).sort(compareText);
  if (regionHashes.length !== 55 || new Set(regionHashes).size !== 55) fail('Stage-4 envelope identities are incomplete or duplicated.');
  const maskBundle = fs.readFileSync(PREMATERIALIZED_BUNDLE_PATH), maskBundleSha = sha256(maskBundle);
  if (maskBundleSha !== PREMATERIALIZED_BUNDLE_SHA256) fail('Pre-materialized mask bundle hash mismatch.');
  if (maskBundle.length !== regionHashes.length * BYTES_PER_MASK) fail('Pre-materialized mask bundle length mismatch.');
  const relations = relationMap(trajectoryCase);
  const v3Case = source.step6_v3_result.value.cases.find(item => item.calibration_case === 'volume_bands');
  const v4Case = source.step6_v4_result.value.cases.find(item => item.calibration_case === 'volume_bands');
  if (!v3Case || !v4Case) fail('Volume Bands Step-6 v003/v004 publication sources are missing.');
  const stage6 = stage6Data(v3Case, v4Case);
  const regions = Object.fromEntries(regionHashes.map((membership, index) => {
    const envelope = trajectoryCase.envelopes[membership], relation = relations.relations.get(membership);
    const offset = index * BYTES_PER_MASK, bytes = maskBundle.subarray(offset, offset + BYTES_PER_MASK);
    assertZeroPadding(bytes);
    if (popcount(bytes) !== envelope.cell_count) fail(`${membership}: pre-materialized mask count mismatch.`);
    const stage6Annotation = stage6.candidate_annotations[regionId(membership)] || null;
    return [regionId(membership), {
      region_id: regionId(membership), membership_hash: membership, cell_count: envelope.cell_count,
      stage: 4, rung: envelope.rung, context_id: envelope.context_id,
      parent_region_ids: [...relation.parents].sort(compareText).map(regionId),
      child_region_ids: [...relation.children].sort(compareText).map(regionId),
      descendant_terminal_region_ids: [...relation.descendants].sort(compareText),
      mask: { offset_bytes: offset, length_bytes: BYTES_PER_MASK, encoding: 'physical_canonical_fixed_bitset_lsb0', cell_count: envelope.cell_count },
      roles: stage6Annotation ? [...new Set(stage6Annotation.selected_in.map(item => item.mode))] : [],
      ranks: stage6Annotation ? Object.fromEntries(Object.entries(stage6.tolerances).map(([gridId, grid]) => [gridId, Object.fromEntries(['performance', 'stability'].map(mode => [mode, grid.modes[mode].runs.map(run => ({ weight_id: run.weight_id, rank: run.ranking.find(item => item.region_id === regionId(membership))?.rank ?? null }))]))])) : null
    }];
  }));
  const contextCase = source.step6_context_spans.value.cases.find(item => item.calibration_case === 'volume_bands');
  if (!contextCase) fail('Volume Bands context-span identity is missing.');
  const stage5 = stage5Annotations(trajectoryCase, source.step5_evidence.value, source.step5_joint.value, sourceHashes);
  const manifestBase = {
    schema_version: 1, artifact_type: 'region_analyzer_manifest', version_id: VERSION_ID, immutable: true,
    surface: {
      surface_id: TARGET_SURFACE_ID, domain_kind: 'rectangular_physical_package', physical_cells: PHYSICAL_CELLS,
      package_sha256: anchors.bindings.package_sha256, descriptor_sha256: anchors.bindings.descriptor_sha256,
      cleaned_domain_identity: anchors.bindings.cleaned_domain_identity,
      canonical_physical_cell_order: { identity: 'sha256_utf8_header_then_analysis_keys_in_physical_canonical_index_order_each_with_lf', sha256: CANONICAL_PHYSICAL_ORDER_SHA256 },
      topology_engine_version: anchors.bindings.topology_engine_version, topology_sha256: contextCase.topology_sha256,
      cleaned_domain_mask: { kind: 'ALL_PHYSICAL_CELLS', physical_cells: PHYSICAL_CELLS }
    },
    mask_bundle: {
      path: `../bundles/${maskBundleSha}.masks.bin`, sha256: maskBundleSha, bytes: maskBundle.length,
      physical_cells_per_mask: PHYSICAL_CELLS, bytes_per_mask: BYTES_PER_MASK,
      bit_order: 'LSB_FIRST_WITHIN_BYTE', final_byte_padding: 'ZERO', region_order: 'MEMBERSHIP_HASH_LEXICOGRAPHIC',
      source_status: 'PREMATERIALIZED_IMMUTABLE_INPUT', regeneration: 'SEPARATE_EXPLICIT_DEEP_MATERIALIZATION_ONLY'
    },
    source_artifacts: Object.fromEntries(Object.entries(sourceHashes).map(([id, hash]) => [id, { sha256: hash }])),
    policies: {
      step4: { id: anchors.bindings.step4_policy_id, version: anchors.bindings.step4_policy_version, sha256: anchors.bindings.step4_policy_sha256 },
      step5: { id: source.step5_policy.value.policy_id, version: source.step5_policy.value.policy_version, sha256: source.step5_policy.sha256 },
      step6_v1: { id: source.step6_v1_policy.value.policy_id, version: source.step6_v1_policy.value.policy_version, sha256: source.step6_v1_policy.sha256 },
      step6_v2: { id: source.step6_v2_policy.value.policy_id, version: source.step6_v2_policy.value.policy_version, sha256: source.step6_v2_policy.sha256 },
      step6_v3: { id: source.step6_v3_policy.value.policy_id, version: source.step6_v3_policy.value.policy_version, sha256: source.step6_v3_policy.sha256 },
      step6_v4: { id: source.step6_v4_policy.value.policy_id, version: source.step6_v4_policy.value.policy_version, sha256: source.step6_v4_policy.sha256 }
    },
    region_dictionary: regions,
    stages: { stage4: { all_unique_lineage_envelopes: regionHashes.map(regionId), lineages: relations.lineages }, stage5: { annotations_by_region_id: stage5 }, stage6 },
    browser_contract: { verify_all_identities_before_render: true, research_recomputation_forbidden: true, best_effort_remapping_forbidden: true }
  };
  const payloadBytes = Buffer.from(`${JSON.stringify(manifestBase, null, 2)}\n`, 'utf8');
  const manifest = { ...manifestBase, content_identity: { hash_method: 'sha256_exact_pre_identity_manifest_payload_bytes', payload_sha256: sha256(payloadBytes) } };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'), manifestSha = sha256(manifestBytes);
  return { manifest, manifestBytes, manifestSha, maskBundle, maskBundleSha, sourceHashes };
}

function validatePublication(publication) {
  const { manifest, maskBundle } = publication;
  if (sha256(publication.manifestBytes) !== publication.manifestSha || sha256(maskBundle) !== publication.maskBundleSha) fail('Publication content hash mismatch.');
  if (publication.maskBundleSha !== PREMATERIALIZED_BUNDLE_SHA256) fail('Publication does not use the approved pre-materialized bundle.');
  const regionEntries = Object.values(manifest.region_dictionary);
  if (regionEntries.length !== 55 || new Set(regionEntries.map(region => region.membership_hash)).size !== 55) fail('Region dictionary deduplication failed.');
  for (const region of regionEntries) {
    const bytes = maskBundle.subarray(region.mask.offset_bytes, region.mask.offset_bytes + region.mask.length_bytes);
    assertZeroPadding(bytes);
    if (popcount(bytes) !== region.cell_count) fail(`${region.region_id}: mask count mismatch.`);
  }
  const stage4 = new Set(manifest.stages.stage4.all_unique_lineage_envelopes);
  if (stage4.size !== 55 || Object.keys(manifest.stages.stage5.annotations_by_region_id).some(id => !stage4.has(id))) fail('Stage-5 reference integrity failed.');
  for (const tolerance of Object.values(manifest.stages.stage6.tolerances)) for (const mode of Object.values(tolerance.modes)) for (const id of mode.candidates) if (!stage4.has(id)) fail('Stage-6 candidate is outside Stage 4.');
  if (manifest.stages.stage6.ranking_status !== 'calibration' || manifest.stages.stage6.stopping_status !== 'calibration' || manifest.stages.stage6.tolerance_policy_frozen || manifest.stages.stage6.center_weights_frozen || manifest.stages.stage6.shortlist_frozen) fail('Step-6 calibration status mismatch.');
  for (const tolerance of Object.values(manifest.stages.stage6.tolerances)) for (const mode of Object.values(tolerance.modes)) for (const run of mode.runs) {
    if (run.performance_weight == null || run.stability_weight == null || Math.abs(run.performance_weight + run.stability_weight - 1) > 1e-12) fail('Stage-6 v004 ranking weights are invalid.');
  }
  return publication;
}

function writeImmutable(file, bytes) {
  if (fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(bytes)) fail(`${file}: immutable asset collision.`);
    return;
  }
  fs.writeFileSync(file, bytes);
}

function publish() {
  const publication = validatePublication(buildPublication());
  fs.mkdirSync(VERSION_ROOT, { recursive: true });
  const manifestName = `${publication.manifestSha}.manifest.json`, bundleName = `${publication.maskBundleSha}.masks.bin`;
  const manifestPath = path.join(VERSION_ROOT, manifestName);
  writeImmutable(manifestPath, publication.manifestBytes);
  let catalog = { schema_version: 1, artifact_type: 'region_analyzer_version_catalog', surfaces: {} };
  if (fs.existsSync(CATALOG_PATH)) catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  if (!catalog.surfaces[TARGET_SURFACE_ID]) catalog.surfaces[TARGET_SURFACE_ID] = { versions: [] };
  const versions = catalog.surfaces[TARGET_SURFACE_ID].versions, existing = versions.find(item => item.version_id === VERSION_ID);
  const entry = {
    version_id: VERSION_ID, content_sha256: publication.manifestSha,
    label: 'Volume Bands shoulder-expanded Region Analyzer calibration v002', created_at: existing?.created_at || new Date().toISOString(), status: 'active',
    manifest_path: `versions/${manifestName}`, mask_bundle_path: `bundles/${bundleName}`, mask_bundle_sha256: publication.maskBundleSha
  };
  if (existing && (existing.content_sha256 !== entry.content_sha256 || existing.mask_bundle_sha256 !== entry.mask_bundle_sha256)) fail('Version ID collision requires a new immutable version ID.');
  if (existing) versions[versions.indexOf(existing)] = entry; else versions.push(entry);
  versions.sort((a, b) => compareText(a.version_id, b.version_id));
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  return { manifestPath, bundlePath: PREMATERIALIZED_BUNDLE_PATH, catalogPath: CATALOG_PATH, ...publication };
}

function main() {
  if (process.argv[2] !== 'publish-volume-bands') fail('Usage: node region-analyzer-publisher-v001.cjs publish-volume-bands');
  const result = publish();
  process.stdout.write(`${JSON.stringify({ version_id: VERSION_ID, manifest_path: result.manifestPath, manifest_sha256: result.manifestSha, manifest_bytes: result.manifestBytes.length, mask_bundle_path: result.bundlePath, mask_bundle_sha256: result.maskBundleSha, mask_bundle_bytes: result.maskBundle.length, catalog_path: result.catalogPath, regions: Object.keys(result.manifest.region_dictionary).length }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { popcount, assertZeroPadding, assertBitsetSubset, relationMap, stage5Annotations, stage6Data, validateSourceBindings, buildPublication, validatePublication, publish };
