'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const staging=fs.readFileSync(path.join(__dirname,'..','staging-v1.html'),'utf8');

assert.doesNotMatch(staging,/fetch\('index\.html/,'v1 staging must not rebuild itself from index.html at runtime');
assert.doesNotMatch(staging,/document\.write\(/,'v1 staging must be a direct static entrypoint');
assert.doesNotMatch(staging,/boot-sync-v030\.js/,'v1 staging must not load legacy boot sync');
assert.doesNotMatch(staging,/scan-layer-v033\.js/,'v1 staging must not load legacy Scan execution');
assert.doesNotMatch(staging,/rr-presentation-v036\.js|rr-fragment-labels-v037\.js/,'v1 staging must not load legacy RR polling scripts directly');

const expected=[
  'session-v001.js?v=001',
  'surface-package-core-v001.js?v=001',
  'session-package-bridge-v001.js?v=001',
  'surface-filter-core-v001.js?v=001',
  'session-browser-bridge-v001.js?v=001',
  'session-scan-bridge-v001.js?v=001',
  'session-rr-bridge-v001.js?v=001',
  'session-analysis-bridge-v001.js?v=001'
];
for(const src of expected)assert.match(staging,new RegExp(src.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')),`missing ${src}`);

console.log('PASS  staging v1 is a direct static entrypoint with canonical session bridges');
