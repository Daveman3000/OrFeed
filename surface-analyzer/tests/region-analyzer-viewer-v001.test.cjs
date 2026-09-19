'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const staging=fs.readFileSync(path.join(root,'staging-v1.html'),'utf8');
const viewer=fs.readFileSync(path.join(root,'region-analyzer-viewer-v001.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'session-package-bridge-v001.js'),'utf8');
assert.doesNotThrow(()=>new Function(viewer),'viewer must parse as JavaScript');

assert.match(staging,/region-analyzer-viewer-v001\.js\?v=012/,'staging must load the Region Analyzer viewer');
assert.match(staging,/RA v012/,'staging must expose the Region Analyzer build version');
assert.match(viewer,/region-analyzer\/catalog\.json/,'viewer must use the static Region Analyzer catalog');
for(const forbidden of ['computeStructuralRobustness','computeFacetReplication','ensureTopology','runScan(']){
  assert.ok(!viewer.includes(forbidden),`viewer must not invoke research recomputation: ${forbidden}`);
}
assert.match(bridge,/regionAnalyzerIdentity/,'package bridge must expose Region Analyzer package identity');
assert.match(bridge,/packageSha256/,'package bridge must expose exact package SHA-256');
assert.match(bridge,/descriptorSha256/,'package bridge must expose exact descriptor SHA-256');
assert.match(viewer,/physicalIndexByVisual/,'viewer must use the exact canonical physical-index map');
assert.match(viewer,/function exactPhysicalMap\(cur,src\)/,'viewer must derive visible mask indices from the canonical source map');
assert.match(viewer,/Canonical physical-index map is not a permutation/,'viewer must reject invalid canonical physical maps');
assert.match(viewer,/Visible cell is outside the canonical package/,'filtered cells must bind exactly to canonical source coordinates');
assert.match(viewer,/snap\?\.sourceSurface/,'viewer must verify masks against the canonical source surface when the visible surface is filtered');
assert.match(viewer,/const RUNG_HUES=\[220,190,145,36,334\]/,'Region Analyzer must use an ordered P-rung hue progression');
assert.match(viewer,/function rungColor\(id,r\)/,'viewer must derive color from rung first and region identity second');
assert.match(viewer,/sort\(\(a,b\)=>a\.p-b\.p\|\|String\(b\.id\)\.localeCompare\(String\(a\.id\)\)\)/,'overlapping masks must composite by P rung, with highest P winning and stable same-rung tie-break');
assert.match(viewer,/im\.data\[px\+3\]=156/,'region fill opacity must be uniform and clearly visible');
assert.doesNotMatch(viewer,/bound\?235:78|left=c\?lab\[i-1\]|right=c<cur\.cols-1\?lab\[i\+1\]/,'Region Analyzer must not add boundary or edge emphasis');
assert.match(viewer,/Object\.entries\(m\?\.region_dictionary\|\|\{\}\)\.map\(\(\[id,r\]\)=>\[id,rungColor\(id,r\)\]\)/,'viewer must freeze rung-aware colors by region identity');
assert.match(viewer,/function regionColor\(id\)\{return regionColors\.get\(id\)\|\|rungColor\(id,manifest\?\.region_dictionary\?\.\[id\]\);\}/,'region color lookup must use the fixed rung-aware table');
assert.match(viewer,/initRegionColors\(manifest\);refresh\(\);render\(\);/,'manifest color table must be initialized before rendering regions');
assert.match(viewer,/color:regionColor\(id\)/,'rendered regions must carry their identity-derived color');
assert.doesNotMatch(viewer,/COLORS\[i%COLORS\.length\]/,'region colors must not depend on visible list position');
assert.match(viewer,/id=\"raEnabled\"/,'viewer menu must expose a Region Analyzer on/off control');
assert.match(viewer,/if\(!active\|\|!manifest/,'Region Analyzer off must suppress mask rendering without discarding state');
assert.match(viewer,/#raOverlay\{[^}]*background:transparent!important/,'Region Analyzer overlay must stay transparent over the base heatmap');
assert.doesNotMatch(viewer,/function mapping\(|mapping\(cur,src\)/,'viewer must not best-effort remap masks from semantic parameters');

console.log('PASS  Region Analyzer viewer is a static verifier/renderer with lightweight package identity binding');
