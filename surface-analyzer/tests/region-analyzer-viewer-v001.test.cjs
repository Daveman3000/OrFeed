'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const staging=fs.readFileSync(path.join(root,'staging-v1.html'),'utf8');
const viewer=fs.readFileSync(path.join(root,'region-analyzer-viewer-v001.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'session-package-bridge-v001.js'),'utf8');
assert.doesNotThrow(()=>new Function(viewer),'viewer must parse as JavaScript');

assert.match(staging,/region-analyzer-viewer-v001\.js\?v=003/,'staging must load the Region Analyzer viewer');
assert.match(viewer,/region-analyzer\/catalog\.json/,'viewer must use the static Region Analyzer catalog');
for(const forbidden of ['computeStructuralRobustness','computeFacetReplication','ensureTopology','runScan(']){
  assert.ok(!viewer.includes(forbidden),`viewer must not invoke research recomputation: ${forbidden}`);
}
assert.match(bridge,/regionAnalyzerIdentity/,'package bridge must expose Region Analyzer package identity');
assert.match(bridge,/packageSha256/,'package bridge must expose exact package SHA-256');
assert.match(bridge,/descriptorSha256/,'package bridge must expose exact descriptor SHA-256');
assert.match(viewer,/physicalIndexByVisual/,'viewer must use the exact canonical physical-index map');
assert.match(viewer,/id=\"raEnabled\"/,'viewer menu must expose a Region Analyzer on/off control');
assert.match(viewer,/if\(!active\|\|!manifest/,'Region Analyzer off must suppress mask rendering without discarding state');
assert.doesNotMatch(viewer,/function mapping\(|mapping\(cur,src\)/,'viewer must not best-effort remap masks from semantic parameters');

console.log('PASS  Region Analyzer viewer is a static verifier/renderer with lightweight package identity binding');
