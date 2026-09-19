'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const bridge=fs.readFileSync(path.join(__dirname,'..','session-package-bridge-v001.js'),'utf8');
const staging=fs.readFileSync(path.join(__dirname,'..','staging-v1.html'),'utf8');

assert.match(bridge,/SurfacePackageCoreV001/,'browser package bridge must use the canonical package core');
assert.match(bridge,/core\.buildSemanticSurface\(text,descriptor,file\)/,'semantic surface construction must delegate to the canonical core');
assert.match(bridge,/document\.addEventListener\('change',[\s\S]*\},true\)/,'bridge must intercept package uploads before the legacy target listener');
assert.match(bridge,/e\.stopImmediatePropagation\(\)/,'canonical package upload must suppress the duplicate legacy parser path');
assert.doesNotMatch(bridge,/function buildSemanticSurface/,'browser bridge must not duplicate semantic package construction');

const corePos=staging.indexOf('surface-package-core-v001.js?v=002');
const bridgePos=staging.indexOf('session-package-bridge-v001.js?v=002');
const filterPos=staging.indexOf('surface-filter-core-v001.js?v=002');
assert.ok(corePos>=0&&bridgePos>corePos&&filterPos>bridgePos,'staging must load package core and browser bridge before downstream research bridges');
console.log('PASS  staging package uploads construct surfaces through the canonical package core');
