'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ASSET_ROOT = path.join(ROOT, 'region-analyzer');
const VERSION_ROOT = path.join(ASSET_ROOT, 'versions');
const BUNDLE_ROOT = path.join(ASSET_ROOT, 'bundles');
const CATALOG_PATH = path.join(ASSET_ROOT, 'catalog.json');
const TARGET_SURFACE_ID = 'volspike_20260911_step3clean_trades_v1';
const VERSION_ID = `${TARGET_SURFACE_ID}-region-analyzer-v001`;

const SOURCES = {
  step4: path.join(ROOT, 'policies', 'exploratory', 'volspike-step4-frozen-anchors-v002.json'),
  step5_joint: path.join(ROOT, 'policies', 'exploratory', 'step5-joint-calibration-v001.json'),
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

function assertZeroPadding(bytes, physicalCells) {
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
  for (let index = 0; index < regionBytes.length; index++) {
    if (regionBytes[index] & (~domainBytes[index] & 0xff)) fail('Region mask is not a subset of the cleaned-domain mask.');
  }
  return true;
}

function relationMap(step4) {
  const hashes = step4.membership_bundle.regions.map(region => region.membership_sha256);
  const relations = new Map(hashes.map(hash => [hash, { parents: new Set(), children: new Set(), descendants: new Set(), contexts: new Set() }]));
  const lineages = step4.anchors.map(anchor => {
    const ancestry = anchor.lineage_ancestry.map(item => item.membership_sha256);
    for (const hash of ancestry) {
      const relation = relations.get(hash);
      if (!relation) fail(`${hash}: lineage membership is absent from the frozen bundle.`);
      relation.descendants.add(anchor.region_id);
      relation.contexts.add(anchor.context_id);
    }
    for (let index = 1; index < ancestry.length; index++) {
      relations.get(ancestry[index - 1]).children.add(ancestry[index]);
      relations.get(ancestry[index]).parents.add(ancestry[index - 1]);
    }
    return {
      terminal_region_id: anchor.region_id,
      terminal_performance_class: anchor.performance_class,
      context_id: anchor.context_id,
      stage4_region_ids: ancestry.map(regionId)
    };
  });
  for (const [hash, relation] of relations) {
    if (relation.contexts.size !== 1) fail(`${hash}: expected exactly one frozen context.`);
    if (relation.parents.size > 1 || relation.children.size > 1) fail(`${hash}: VolSpike frozen lineage must be non-branching.`);
  }
  return { relations, lineages };
}

function stage5Annotations(step4, joint, jointSha) {
  const membershipByRegion = new Map(step4.anchors.map(anchor => [anchor.region_id, anchor.anchor_membership_sha256]));
  const jointCase = joint.cases.find(item => item.calibration_case === 'volspike');
  if (!jointCase) fail('VolSpike Step-5 joint calibration case is missing.');
  const out = {};
  for (const result of jointCase.results) {
    const membership = membershipByRegion.get(result.region_id);
    if (!membership) fail(`${result.region_id}: Step-5 result has no frozen Step-4 anchor.`);
    out[regionId(membership)] = {
      region_id: regionId(membership),
      membership_hash: membership,
      evidence_authority: 'STORED_STEP5_JOINT_CALIBRATION',
      evidence_source_artifacts: [{ id: 'step5-joint-calibration-v001', sha256: jointSha }],
      profile: result.profile,
      sr: result.sr,
      rr: result.rr,
      fr: result.fr,
      boundary_conditioning: result.boundary_conditioning,
      support: { cell_count: result.anchor_cells, lineage: result.lineage }
    };
  }
  return out;
}

function rankingRun(run) {
  const weights = run.ranking[0]?.components?.weights || {};
  return {
    weight_id: run.weight_id,
    performance_weight: weights.performance ?? null,
    stability_weight: weights.stability ?? null,
    ranking: run.ranking.map(item => ({
      region_id: regionId(item.membership_sha256),
      rank: item.rank,
      score: item.score
    }))
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

function stage6Data(v4Case, frozenRegionHashes) {
  const labels = { strict: 'Low', center: 'Mid', loose: 'High' };
  const order = ['strict', 'center', 'loose'];
  const frozen = new Set(frozenRegionHashes);
  const candidateAnnotations = {};
  const tolerances = {};
  for (const gridId of order) {
    const grid = v4Case.grids.find(item => item.grid_id === gridId);
    if (!grid) fail(`Stage-6 ${gridId} grid is missing.`);
    const modes = {};
    for (const [mode, role] of [['performance', 'performance_led'], ['stability', 'stability_led']]) {
      const source = grid.roles[role];
      const hashes = source.candidate_membership_sha256_in_v003_order;
      for (const membership of hashes) if (!frozen.has(membership)) fail(`${membership}: Stage-6 candidate is outside frozen Step 4.`);
      const runs = source.ranking_runs.map(rankingRun);
      const componentsByHash = new Map((source.ranking_runs[0]?.ranking || []).map(item => [item.membership_sha256, item.components]));
      for (const membership of hashes) {
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
        candidate_count: hashes.length,
        candidates: hashes.map(regionId),
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

function buildPublication() {
  const source = Object.fromEntries(Object.entries(SOURCES).map(([id, file]) => [id, readJson(file)]));
  const sourceHashes = Object.fromEntries(Object.entries(source).map(([id, item]) => [id, item.sha256]));
  const step4 = source.step4.value, bundleMeta = step4.membership_bundle;
  if (step4.bindings.surface_id !== TARGET_SURFACE_ID) fail('VolSpike Step-4 artifact is bound to the wrong surface.');
  if (bundleMeta.physical_cells !== 56000 || bundleMeta.bytes_per_mask !== 7000) fail('Unexpected VolSpike physical mask geometry.');
  if (bundleMeta.cleaned_domain_mask?.kind !== 'BUNDLE_BITSET' || bundleMeta.cleaned_domain_mask.cell_count !== 41195) fail('Unexpected VolSpike cleaned-domain mask contract.');

  const bundlePath = path.join(BUNDLE_ROOT, path.basename(bundleMeta.path));
  const maskBundle = fs.readFileSync(bundlePath), maskBundleSha = sha256(maskBundle);
  if (maskBundleSha !== bundleMeta.sha256 || maskBundle.length !== bundleMeta.bytes) fail('VolSpike frozen mask bundle identity mismatch.');

  const domainMeta = bundleMeta.cleaned_domain_mask;
  const domainBytes = maskBundle.subarray(domainMeta.offset_bytes, domainMeta.offset_bytes + domainMeta.length_bytes);
  assertZeroPadding(domainBytes, bundleMeta.physical_cells);
  if (popcount(domainBytes) !== domainMeta.cell_count) fail('VolSpike cleaned-domain popcount mismatch.');

  const frozenRegions = bundleMeta.regions.slice().sort((a, b) => compareText(a.membership_sha256, b.membership_sha256));
  if (frozenRegions.length !== 173 || new Set(frozenRegions.map(region => region.membership_sha256)).size !== 173) fail('Expected exactly 173 unique VolSpike Step-4 regions.');
  const regionHashes = frozenRegions.map(region => region.membership_sha256);
  const relations = relationMap(step4);

  const v4Case = source.step6_v4_result.value.cases.find(item => item.calibration_case === 'volspike');
  if (!v4Case) fail('VolSpike Stage-6 v004 case is missing.');
  const stage6 = stage6Data(v4Case, regionHashes);

  const regions = Object.fromEntries(frozenRegions.map(region => {
    const membership = region.membership_sha256, relation = relations.relations.get(membership);
    const bytes = maskBundle.subarray(region.offset_bytes, region.offset_bytes + region.length_bytes);
    assertZeroPadding(bytes, bundleMeta.physical_cells);
    if (popcount(bytes) !== region.cell_count) fail(`${membership}: frozen mask count mismatch.`);
    assertBitsetSubset(bytes, domainBytes);
    const stage6Annotation = stage6.candidate_annotations[regionId(membership)] || null;
    return [regionId(membership), {
      region_id: regionId(membership),
      membership_hash: membership,
      cell_count: region.cell_count,
      stage: 4,
      rung: region.rung,
      context_id: [...relation.contexts][0],
      parent_region_ids: [...relation.parents].sort(compareText).map(regionId),
      child_region_ids: [...relation.children].sort(compareText).map(regionId),
      descendant_terminal_region_ids: [...relation.descendants].sort(compareText),
      mask: {
        offset_bytes: region.offset_bytes,
        length_bytes: region.length_bytes,
        encoding: bundleMeta.encoding,
        cell_count: region.cell_count
      },
      roles: stage6Annotation ? [...new Set(stage6Annotation.selected_in.map(item => item.mode))] : [],
      ranks: stage6Annotation ? Object.fromEntries(Object.entries(stage6.tolerances).map(([gridId, grid]) => [gridId, Object.fromEntries(['performance', 'stability'].map(mode => [mode, grid.modes[mode].runs.map(run => ({ weight_id: run.weight_id, rank: run.ranking.find(item => item.region_id === regionId(membership))?.rank ?? null }))]))])) : null
    }];
  }));

  const stage5 = stage5Annotations(step4, source.step5_joint.value, sourceHashes.step5_joint);
  const v4Policy = source.step6_v4_policy.value;
  const manifestBase = {
    schema_version: 1,
    artifact_type: 'region_analyzer_manifest',
    version_id: VERSION_ID,
    immutable: true,
    surface: {
      surface_id: TARGET_SURFACE_ID,
      storage_surface_id: step4.bindings.storage_surface_id,
      domain_kind: 'rectangular_physical_package',
      physical_cells: bundleMeta.physical_cells,
      package_sha256: step4.bindings.package_sha256,
      descriptor_sha256: step4.bindings.descriptor_sha256,
      cleaned_domain_identity: step4.bindings.cleaned_domain_identity,
      canonical_physical_cell_order: bundleMeta.canonical_physical_cell_order,
      topology_engine_version: step4.bindings.topology_engine_version,
      cleaned_domain_mask: {
        ...domainMeta,
        encoding: bundleMeta.encoding
      }
    },
    mask_bundle: {
      path: `../bundles/${maskBundleSha}.masks.bin`,
      sha256: maskBundleSha,
      bytes: maskBundle.length,
      physical_cells_per_mask: bundleMeta.physical_cells,
      bytes_per_mask: bundleMeta.bytes_per_mask,
      bit_order: bundleMeta.bit_order,
      final_byte_padding: bundleMeta.final_byte_padding,
      region_order: bundleMeta.region_order,
      source_status: 'PREMATERIALIZED_IMMUTABLE_INPUT',
      regeneration: 'FORBIDDEN_IN_BROWSER'
    },
    source_artifacts: {
      step4: { sha256: sourceHashes.step4 },
      step5_joint: { sha256: sourceHashes.step5_joint },
      step6_v3_policy: { sha256: v4Policy.source_binding.v003_policy_sha256 },
      step6_v3_result: { sha256: v4Policy.source_binding.v003_result_sha256 },
      step6_v4_policy: { sha256: sourceHashes.step6_v4_policy },
      step6_v4_result: { sha256: sourceHashes.step6_v4_result }
    },
    policies: {
      step4: {
        id: step4.bindings.step4_policy_id,
        version: step4.bindings.step4_policy_version,
        sha256: step4.bindings.step4_policy_sha256
      },
      step6_v4: {
        id: v4Policy.policy_id,
        version: v4Policy.policy_version,
        sha256: sourceHashes.step6_v4_policy
      }
    },
    region_dictionary: regions,
    stages: {
      stage4: {
        all_unique_lineage_envelopes: regionHashes.map(regionId),
        lineages: relations.lineages
      },
      stage5: { annotations_by_region_id: stage5 },
      stage6
    },
    browser_contract: {
      verify_all_identities_before_render: true,
      research_recomputation_forbidden: true,
      best_effort_remapping_forbidden: true
    }
  };

  const payloadBytes = Buffer.from(`${JSON.stringify(manifestBase, null, 2)}\n`, 'utf8');
  const manifest = {
    ...manifestBase,
    content_identity: {
      hash_method: 'sha256_exact_pre_identity_manifest_payload_bytes',
      payload_sha256: sha256(payloadBytes)
    }
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return {
    manifest,
    manifestBytes,
    manifestSha: sha256(manifestBytes),
    maskBundle,
    maskBundleSha,
    sourceHashes
  };
}

function validatePublication(publication) {
  const { manifest, maskBundle } = publication;
  if (sha256(publication.manifestBytes) !== publication.manifestSha || sha256(maskBundle) !== publication.maskBundleSha) fail('Publication content hash mismatch.');
  const domain = manifest.surface.cleaned_domain_mask;
  const domainBytes = maskBundle.subarray(domain.offset_bytes, domain.offset_bytes + domain.length_bytes);
  if (popcount(domainBytes) !== 41195) fail('Published cleaned-domain popcount mismatch.');

  const regions = Object.values(manifest.region_dictionary);
  if (regions.length !== 173 || new Set(regions.map(region => region.membership_hash)).size !== 173) fail('Region dictionary identity mismatch.');
  for (const region of regions) {
    const bytes = maskBundle.subarray(region.mask.offset_bytes, region.mask.offset_bytes + region.mask.length_bytes);
    assertZeroPadding(bytes, manifest.surface.physical_cells);
    if (popcount(bytes) !== region.cell_count) fail(`${region.region_id}: mask count mismatch.`);
    assertBitsetSubset(bytes, domainBytes);
  }

  if (Object.keys(manifest.stages.stage5.annotations_by_region_id).length !== 71) fail('Expected 71 frozen VolSpike terminal Step-5 annotations.');
  const expected = {
    strict: { performance: 27, stability: 4 },
    center: { performance: 30, stability: 4 },
    loose: { performance: 69, stability: 4 }
  };
  for (const [gridId, counts] of Object.entries(expected)) {
    const modes = manifest.stages.stage6.tolerances[gridId].modes;
    if (modes.performance.candidate_count !== counts.performance || modes.stability.candidate_count !== counts.stability) fail(`${gridId}: Stage-6 candidate count mismatch.`);
    for (const mode of Object.values(modes)) for (const run of mode.runs) {
      if (run.performance_weight == null || run.stability_weight == null || Math.abs(run.performance_weight + run.stability_weight - 1) > 1e-12) fail('Stage-6 v004 ranking weights are invalid.');
    }
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
  const manifestName = `${publication.manifestSha}.manifest.json`;
  const manifestPath = path.join(VERSION_ROOT, manifestName);
  writeImmutable(manifestPath, publication.manifestBytes);

  let catalog = { schema_version: 1, artifact_type: 'region_analyzer_version_catalog', surfaces: {} };
  if (fs.existsSync(CATALOG_PATH)) catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
  if (!catalog.surfaces[TARGET_SURFACE_ID]) catalog.surfaces[TARGET_SURFACE_ID] = { versions: [] };
  const versions = catalog.surfaces[TARGET_SURFACE_ID].versions;
  const existing = versions.find(item => item.version_id === VERSION_ID);
  const entry = {
    version_id: VERSION_ID,
    content_sha256: publication.manifestSha,
    label: 'VolSpike frozen Region Analyzer calibration v001',
    created_at: existing?.created_at || new Date().toISOString(),
    status: 'active',
    manifest_path: `versions/${manifestName}`,
    mask_bundle_path: `bundles/${publication.maskBundleSha}.masks.bin`,
    mask_bundle_sha256: publication.maskBundleSha
  };
  if (existing && (existing.content_sha256 !== entry.content_sha256 || existing.mask_bundle_sha256 !== entry.mask_bundle_sha256)) fail('Version ID collision requires a new immutable version ID.');
  if (existing) versions[versions.indexOf(existing)] = entry; else versions.push(entry);
  versions.sort((a, b) => compareText(a.version_id, b.version_id));
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  return { manifestPath, catalogPath: CATALOG_PATH, ...publication };
}

function main() {
  if (process.argv[2] !== 'publish-volspike') fail('Usage: node region-analyzer-volspike-publisher-v001.cjs publish-volspike');
  const result = publish();
  process.stdout.write(`${JSON.stringify({
    version_id: VERSION_ID,
    manifest_path: result.manifestPath,
    manifest_sha256: result.manifestSha,
    manifest_bytes: result.manifestBytes.length,
    mask_bundle_sha256: result.maskBundleSha,
    mask_bundle_bytes: result.maskBundle.length,
    catalog_path: result.catalogPath,
    regions: Object.keys(result.manifest.region_dictionary).length
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  popcount,
  assertZeroPadding,
  assertBitsetSubset,
  relationMap,
  stage5Annotations,
  stage6Data,
  buildPublication,
  validatePublication,
  publish
};
