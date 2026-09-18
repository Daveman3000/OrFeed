'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const nodeRequire = createRequire(path.join(ROOT, 'node', 'package.json'));
const { strFromU8, unzipSync } = nodeRequire('fflate');
const POLICY = path.join(ROOT, 'policies', 'exploratory', 'domain-cleaning-step3-v001.json');
const SURFACE_POLICY_V3 = path.join(ROOT, 'policies', 'exploratory', 'volume-bands-surface-policy-v003.json');
const SURFACE_POLICY_V4 = path.join(ROOT, 'policies', 'exploratory', 'volume-bands-surface-policy-v004.json');
const MANIFEST = path.join(ROOT, 'policies', 'exploratory', 'volume-bands-cleaned-domain-step3-v001.json');
const REGISTRY_PACKAGE_V3 = path.join(ROOT, 'registry', 'packages', 'dccbcf8bf9f35f595b0825e5058ade16e4c95ef503fa3b4e9fde522ab08a4cf4.surface.zip');
const REGISTRY_PACKAGE = path.join(ROOT, 'registry', 'packages', 'c0b730c5712b3bfcad1175e55658ce0054b3011d6c6f43a5181aaf0d3d7ac4f4.surface.zip');

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function assertDescriptorBinding(policy, descriptorBytes) {
  const descriptor = JSON.parse(strFromU8(descriptorBytes));
  assert.equal(sha256(descriptorBytes), policy.descriptor_binding.descriptor_sha256);
  assert.deepEqual(
    Object.keys(policy.descriptor_assertions).sort(),
    descriptor.parameters.map(parameter => parameter.id).sort()
  );
  for (const parameter of descriptor.parameters) {
    const assertion = policy.descriptor_assertions[parameter.id];
    assert.equal(assertion.topology_role, parameter.topology_role);
    assert.equal(assertion.source, parameter.source);
    assert.deepEqual(assertion.active_when, parameter.active_when);
  }
}

function analysisKeys(csvText) {
  let header = null;
  let analysisKeyColumn = -1;
  let row = [];
  let field = '';
  let quoted = false;
  const keys = [];
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => {
    endField();
    if (!header) {
      header = row;
      analysisKeyColumn = header.indexOf('analysis_key');
      assert.notEqual(analysisKeyColumn, -1, 'surface.semantic.csv must contain analysis_key');
    } else if (row.some(value => value !== '')) {
      keys.push(row[analysisKeyColumn]);
    }
    row = [];
  };
  for (let index = 0; index < csvText.length; index++) {
    const character = csvText[index];
    if (quoted) {
      if (character === '"') {
        if (csvText[index + 1] === '"') { field += '"'; index++; }
        else quoted = false;
      } else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') endField();
    else if (character === '\n') endRow();
    else if (character !== '\r') field += character;
  }
  if (field.length || row.length) endRow();
  return keys.sort();
}

const policy = readJson(POLICY);
const manifest = readJson(MANIFEST);
const surfacePolicyV3 = readJson(SURFACE_POLICY_V3);
const surfacePolicyV4 = readJson(SURFACE_POLICY_V4);

assert.equal(policy.policy_origin, 'post_result_exploratory');
assert.equal(policy.authoritative, false);
assert.equal(policy.frozen, true);
assert.equal(policy.support.minimum_trades_per_configuration, 15);
assert.equal(policy.pocket_protection.minimum_connected_cells, 8);
assert.equal(policy.facet_peer_eligibility.minimum_common_support_fraction_of_pre_prune, 0.50);

assert.equal(sha256(fs.readFileSync(POLICY)), manifest.cleaning_policy.sha256_exact_file_bytes);
assert.equal(sha256(fs.readFileSync(SURFACE_POLICY_V4)), manifest.surface_policy.sha256_exact_file_bytes);
assert.equal(surfacePolicyV3.descriptor_binding.descriptor_sha256, '2367a68db624d87822a552e9465a64058705694f66ca50fa3072f9e80f529c2c');
assert.equal(surfacePolicyV4.descriptor_binding.descriptor_sha256, manifest.source_surface.descriptor_sha256);
assert.equal(manifest.outcome_summary.removed_cells, 0);
assert.equal(manifest.outcome_summary.retained_cells, manifest.source_surface.source_cells);
assert.equal(manifest.candidate_outcomes.length, manifest.predeclared_candidate_set.candidate_count);
assert.ok(manifest.candidate_outcomes.every(candidate => candidate.outcome === 'KEEP_NOT_WEAK'));

const preimage = manifest.cleaned_domain_identity.identity_preimage_lines.join('\n');
assert.equal(sha256(Buffer.from(preimage, 'utf8')), manifest.cleaned_domain_identity.cleaned_domain_sha256);

if (fs.existsSync(REGISTRY_PACKAGE_V3)) {
  const members = unzipSync(fs.readFileSync(REGISTRY_PACKAGE_V3));
  assertDescriptorBinding(surfacePolicyV3, members['surface_descriptor.json']);
}

if (fs.existsSync(REGISTRY_PACKAGE)) {
  const packageBytes = fs.readFileSync(REGISTRY_PACKAGE);
  assert.equal(sha256(packageBytes), manifest.source_surface.package_sha256);
  const members = unzipSync(packageBytes);
  assertDescriptorBinding(surfacePolicyV4, members['surface_descriptor.json']);
  const keys = analysisKeys(strFromU8(members['surface.semantic.csv']));
  assert.equal(keys.length, Number(manifest.cleaned_domain_identity.identity_preimage_lines
    .find(line => line.startsWith('retained_count='))
    .split('=')[1]));
  assert.equal(
    sha256(Buffer.from(`${keys.join('\n')}\n`, 'utf8')),
    manifest.cleaned_domain_identity.retained_analysis_keys_sha256
  );
}

console.log('domain-cleaning-step3-v001 tests passed');
