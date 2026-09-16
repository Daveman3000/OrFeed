'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','surface-filter-v028.js'),'utf8');

assert.match(source,/SurfaceFilterCoreV001/,'controller must depend on the canonical filter core');
assert.match(source,/applySurfaceFilter\(source,filterSpec\(\)\)/,'display filtering must delegate to the canonical core');
assert.match(source,/hasActiveFilters\(surface,filterSpec\(\)\)/,'active-filter detection must delegate to the canonical core');
assert.match(source,/getFilterSpec:filterSpec/,'controller must expose selection state without exposing filter implementation');
assert.doesNotMatch(source,/function passEntry\(/,'controller must not implement semantic row\/column filtering itself');
assert.doesNotMatch(source,/new Float64Array\(n\)/,'controller must not rebuild filtered metric arrays itself');
assert.doesNotMatch(source,/semanticParameterIndices:params/,'controller must not rebuild filtered semantic-index arrays itself');

console.log('PASS  Surface Filter controller delegates filtering to SurfaceFilterCoreV001');
