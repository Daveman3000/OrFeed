# Surface Analyzer Architecture / API Contract

Status: authoritative refactor target  
Scope: behavior-preserving architecture refactor; no research-logic redesign

## 1. Frozen baseline

Production remains on `gh-pages` and is not a development branch for this refactor.

Frozen baseline for the refactor:

- production commit: `708a8b621187818ff29c62b087f98d1571e8d4ed`
- production state: current known-good v036-era UI with the subsequent semantic-package compatibility/cache-bust fixes
- refactor branch: `surface-analyzer-refactor-v1`

The refactor branch began from that exact commit. Production must remain usable throughout the refactor.

If `gh-pages` changes while the refactor is in progress, do not silently rebase or merge those changes. Reconcile them deliberately after identifying whether they affect Surface Analyzer behavior.

## 2. Non-negotiable behavior invariants

The refactor changes ownership and boundaries, not the research model.

Preserve:

- descriptor-driven semantic topology
- regime hard splits
- facet semantics
- ordered-parameter semantic adjacency
- materialized/tested-domain semantics; do not infer a Cartesian domain
- filtered ordered values do not bridge adjacency
- filtered facet states are not pulled back into Facet Replication
- Structural Robustness and Facet Replication remain separate diagnostics
- robustness remains independent of absolute performance
- scanner criteria remain AND-only
- scanner connectivity remains semantic graph connectivity
- `Show matches only` remains display-only
- Regional Robustness regions remain defined by Performance criteria only
- SR/FR criteria do not define RR regions
- RR depth remains semantic graph depth, not screen depth
- RR normalization remains hard-surface P95-P5 with existing fallback behavior
- RR similarity threshold remains `TAU = 0.10`
- metric inversion behavior remains unchanged
- no weighted composite or best-cell/config ranking
- the N×M upstream research invariant remains unchanged

Auto Format and Axis Layers are presentation concerns. They must not redefine semantic topology or the research domain in the target architecture.

## 3. Current runtime / module map

### 3.1 Static load order

`index.html` statically loads:

1. `app.js`
2. `robustness-topology-v016.js`
3. `robustness-math-v016.js`
4. `robustness-v016.js`
5. `facet-replication-v017.js`
6. `raw-values-v009.js`
7. `semantic-analysis-v030.js`
8. `boot-sync-v030.js`
9. `scan-layer-v033.js` (internal scanner version v035)
10. `rr-presentation-v036.js`
11. `rr-fragment-labels-v037.js`

`raw-values-v009.js` dynamically installs this chain:

`surface-package-v021.js` -> `axis-chrome-v022.js` -> `axis-layer-controls-v023.js` -> `auto-format-v026.js` -> `surface-filter-v028.js`

Several later modules poll until their prerequisites exist, so current behavior depends on both load order and installation readiness.

### 3.2 Current state ownership

| State / responsibility | Current owner(s) | Current behavior / risk |
| --- | --- | --- |
| `activeSurface` | `app.js`, modified/consumed by later wrappers | Global mutable value. Its meaning can be source surface, filtered surface, or presentation-remapped surface depending on lifecycle stage. |
| source/unfiltered surface | `surface-filter-v028.js` as private `fullSurface` | Hidden module state rather than canonical application state. |
| filtered domain | `surface-filter-v028.js` | Materialized as another surface object and routed through `activateSurface`. |
| semantic descriptor / parameter indices | surface object | Correct source of semantic identity, but currently travels through presentation remaps as part of `activeSurface`. |
| semantic topology used by SR/FR | `semantic-analysis-v030.js` private `graphSurface` / `graph` | Cached by active-surface object identity. |
| semantic topology used by scanner/RR | `scan-layer-v033.js` private `graphSurface` / `graph` | A second topology cache owned independently from SR/FR. |
| SR/FR analysis cache | `semantic-analysis-v030.js` | Private `analysisCache`. |
| scanner SR/FR cache | `scan-layer-v033.js` | Separate private `analysisCache`; can recompute the same analysis independently. |
| scan config | `scan-layer-v033.js` | Module state + localStorage. |
| scan result | `scan-layer-v033.js` | Module state associated with `resultSurface` by object identity. |
| RR result | `scan-layer-v033.js` inside scan result | Calculated by pure-ish scanner engine; presentation is owned elsewhere. |
| RR overlay | scanner + `rr-presentation-v036.js` + `rr-fragment-labels-v037.js` | Multiple layers can draw onto the same overlay. |
| metric / mode selection | `app.js`, later wrapped by robustness/facet/semantic modules | Global mutable state. |
| performance values / current analysis values | `app.js` globals `values`, `currentStats` | Used by rendering and hover logic directly. |
| base metric caches | `app.js` `cache`, `statsCache` | Invalidated inside `activateSurface` / reset paths. |
| active persisted surface | `app.js` IndexedDB | Database `surface-analyzer-local`, store `state`, key `active-surface`. |
| Surface Filter preferences | `surface-filter-v028.js` localStorage | Per-surface identity. |
| Axis Layer preferences | `axis-layer-controls-v023.js` localStorage | Per-surface identity. |
| Auto Format preference | `auto-format-v026.js` localStorage | Global preference. |
| scanner preferences | `scan-layer-v033.js` localStorage | Per-surface identity. |

### 3.3 Existing pure-engine footholds

These are valuable and should be reused rather than rewritten.

`semantic-analysis-v030.js` exports a Node-compatible `SurfaceSemanticAnalysisV030` with:

- `buildTopology`
- `computeSR`
- `computeFR`
- `runSyntheticSuite`

`scan-layer-v033.js` exports a Node-compatible `SurfaceScanEngineV035` with:

- `midrankPercentile`
- `connectedRegions`
- `evaluateScan`
- `analyzeRegionalRobustness`

`robustness-topology-v016.js` also exports the historical VolSpike topology builder used by the baseline oracle.

These pure/pure-ish functions are the starting point for the shared engine.

## 4. Current lifecycle coupling

### 4.1 Function-wrapper chain

Current modules repeatedly replace global functions while retaining the previous implementation as `base...`.

Important wrapped functions include:

- `activateSurface`
- `hardReset`
- `setMetric`
- `setMode`
- `draw`
- `populateMetricOptions`
- `setViewForMode`
- `displayQ`
- `robustApprox`
- `updateRobustnessAvailability`
- `normalizeStoredSurface`

For the generic semantic path, the effective `activateSurface` ownership is conceptually:

`semantic analysis -> surface filter -> auto format -> axis-layer controls -> axis chrome -> surface package -> app base`

The exact implementation is assembled at runtime through installation/wait loops rather than declared as one lifecycle pipeline.

This wrapper architecture is the primary nonlocal-regression risk.

### 4.2 Polling / synchronization

Current polling includes:

- module installation retries, commonly every 25 or 50 ms
- `boot-sync-v030.js`: readiness polling every 25 ms, up to 400 retries
- scanner surface synchronization: every 500 ms
- RR presentation synchronization: every 200 ms
- repeated RR fragment-label drawing: every 250 ms

These are not research requirements. They are browser orchestration mechanisms and should be replaced only after explicit session ownership is proven equivalent.

### 4.3 Restore paths

Restore currently has overlapping paths:

1. `app.js` initialization reads IndexedDB into `activeSurface`.
2. `surface-package-v021.js` has a deferred semantic-surface restore path that can read IndexedDB and assign/render the restored surface.
3. `boot-sync-v030.js` waits for the dynamic feature chain and then calls `activateSurface(restored, { persist: false })` again so the fully installed wrappers see the restored surface.

The final architecture must have one restore route. Normal load and persisted restore must converge on the same session method.

Do not remove `boot-sync-v030.js` until that replacement has passed restore regression testing.

## 5. Current effective filter semantics

`surface-filter-v028.js` owns the unfiltered `fullSurface` and creates a filtered surface by materializing only retained rows/columns and their corresponding metric / semantic-parameter arrays.

The later generic semantic layer installs after Surface Filter and computes topology from the currently active filtered surface. Therefore the current intended generic behavior is:

`source surface -> filter -> filtered materialized domain -> topology -> SR / FR -> scan -> RR`

That behavior is authoritative.

The target architecture should represent this explicitly instead of relying on wrapper installation order.

## 6. Current RR presentation-driver behavior

The v036 presentation layer resolves the RR presentation metric as follows:

1. use the currently selected HUD driver metric when that metric is present in the RR region metrics;
2. otherwise fall back to the first RR performance metric.

Top-five ordering is by `boundary_mean_normalized_drop` descending, with cell count as the tie-breaker.

Cyan outline intensity is also driven by normalized boundary deterioration for that resolved metric.

This observed production behavior is the refactor baseline. Do not invent a different multi-metric ordering rule during extraction.

## 7. Target architecture

There are four core layers plus an optional transport layer:

1. **Input / package parsing**
2. **Pure research core**
3. **Canonical `SurfaceAnalyzerSession` state / lifecycle**
4. **Presentation / browser UI**
5. **Optional thin transport adapter**

Conceptually:

`surface package -> explicit source surface -> explicit filtered research domain -> explicit semantic topology -> pure SR / FR / scan / RR -> canonical session -> UI or API client`

The GitHub repository is the canonical home of the engine.

The browser UI and the future local Node API must call the same shared engine/session implementation.

## 8. Canonical state model

### 8.1 Research state

The session owns:

- `sourceSurface`
- `filterSpec`
- `filteredSurface`
- `descriptorIdentity`
- `domainIdentity`
- `topologyIdentity`
- `topology`
- analysis caches by metric
- `scanConfig`
- `scanResult`
- `regionalRobustnessResult`

`sourceSurface` always means the canonical loaded semantic research package. Its meaning must never change because of current UI mode.

`filteredSurface` always means the current research domain after applying Surface Filter.

Presentation transforms must not replace either object as research truth.

### 8.2 Presentation state

Presentation state is separate and may include:

- selected HUD family
- selected HUD metric
- raw / percentile / log display view
- Axis Layer selections
- Auto Format / display projection
- dim-failures toggle
- outline visibility
- show-matches-only toggle
- menu open/closed state
- hover state
- RR label visibility / placement

Presentation state may request analysis results but must not silently redefine the research domain.

## 9. Identity contracts

### Source identity

Derived from semantic package identity/provenance using the existing source-hash/run/file fallbacks until a stronger canonical package ID is available.

### Filter/domain identity

Must be deterministic from:

- source identity
- normalized filter selection

Two equivalent filter specs must produce the same domain identity independent of UI checkbox ordering.

### Topology identity

Must be deterministic from:

- filtered-domain identity
- semantic descriptor identity/version relevant to topology

It must not include screen layout, Axis Layers, Auto Format, selected metric, or presentation state.

## 10. `SurfaceAnalyzerSession` contract

Target conceptual API:

```js
const analyzer = SurfaceAnalyzer.createSession({
  storageAdapter,
  metricMetadata
});

await analyzer.loadSurface(surfaceInput);

analyzer.getState();

analyzer.setFilter(filterSpec);
analyzer.clearFilter();

analyzer.getPerformanceSeries(metricId, { basis: 'raw' | 'percentile' });

analyzer.computeStructuralRobustness(metricId);
analyzer.computeFacetReplication(metricId);

analyzer.runScan(scanConfig);
analyzer.clearScan();

analyzer.runRegionalRobustness({
  minCells,
  performanceCriteria,
  metricIds
});

analyzer.getAnalysisSnapshot();
analyzer.subscribe(listener);
```

Exact naming may change during implementation if the current dependencies justify it. The ownership contract may not.

### Session rules

Research/session methods:

- do not read DOM state
- do not require global `activeSurface`
- do not mutate browser UI
- do not read or write localStorage directly
- receive explicit inputs
- return explicit outputs
- have deterministic cache invalidation
- preserve the previous valid session state if an operation fails before commit

Initially, the session is an orchestration facade over existing behavior. Do not reimplement research formulas while introducing the controller.

## 11. Cache invalidation contract

| Change | Filtered domain | Topology | SR/FR cache | Scan result | RR result |
| --- | ---: | ---: | ---: | ---: | ---: |
| load/replace source surface | invalidate | invalidate | invalidate | invalidate | invalidate |
| semantic descriptor/topology identity change | recompute as needed | invalidate | invalidate | invalidate | invalidate |
| Surface Filter change | invalidate/recompute | invalidate | invalidate | invalidate | invalidate |
| selected HUD metric | no | no | no global invalidation; lazy metric result may be computed | no | no |
| selected raw/pct/log view | no | no | no | no | no |
| scan criteria/config change | no | no | no | invalidate | invalidate |
| scan `min_cells` change | no | no | no | invalidate | invalidate |
| RR enable/metric set change only | no | no | no | preserve base scan when criteria unchanged | invalidate |
| Axis Layers | no | no | no | no | no |
| Auto Format / display projection | no | no | no | no | no |
| dim / outline / show-matches-only | no | no | no | no | no |
| hover/menu/label placement | no | no | no | no | no |

No cache is invalidated merely because an object has been presentation-remapped.

## 12. Persistence contract

Persistence is supplied through an adapter:

```js
storage.get(key)
storage.set(key, value)
storage.remove(key)
```

The browser adapter may use IndexedDB/localStorage internally.

The research core must not know those browser APIs exist.

During the behavior-preserving migration:

- preserve current storage keys where practical
- do not perform gratuitous migrations
- normal load and persisted restore must converge on the same session load path
- persistence failure must not alter research formulas

## 13. Error / transaction behavior

A failed operation must not leave a half-applied research state.

In particular:

- invalid surface load leaves the prior valid session intact
- invalid filter spec leaves the prior filtered domain intact
- failed topology/analysis computation does not replace a previously valid cached result
- a surface change during an async UI operation must invalidate/reject that stale operation rather than committing it to the new surface

The browser may display errors, but error presentation remains outside the research core.

## 14. Serialization contract

The shared JS engine may internally use:

- TypedArrays
- `Map` / `Set` where appropriate
- `NaN` for the existing missing/not-applicable numeric states

Research semantics must not be changed merely to satisfy JSON.

A serializer at the API/transport boundary will define JSON-safe output explicitly. Numeric non-finite states must not be silently changed by native `JSON.stringify` behavior without a documented encoding.

The exact external wire encoding is finalized before the HTTP adapter is added and must be regression-tested.

## 15. Presentation contract

The browser UI consumes session state/results.

Presentation renderers may:

- choose layout
- project/reorder cells for display
- color/dim cells
- draw region boundaries
- draw labels
- display tables and hover details

Presentation renderers may not:

- calculate semantic topology
- redefine filter/domain membership
- calculate SR/FR
- calculate scanner membership
- calculate RR regions/metrics

RR presentation must preserve current visible behavior during migration, including top-five table behavior, cyan boundary intensity, repeated fragment labels, upper-left label placement, and tiny-fragment suppression.

RR presentation consolidation happens late, after research/session migration is stable.

## 16. Web UI and local API

There is one engine.

### Browser path

`GitHub Pages UI -> SurfaceAnalyzerSession -> shared research core`

### Programmatic path

`Codex/local client -> localhost Node adapter -> SurfaceAnalyzerSession -> same shared research core`

The local Node adapter contains zero research logic. It may only:

- validate transport input
- call the shared session/core
- serialize output
- expose health/diagnostic information

Do not create a separate Python or server implementation of SR/FR/scan/RR.

Do not choose or deploy a cloud backend during this refactor.

## 17. Migration order

1. freeze production baseline
2. establish regression harness
3. document architecture/API contract
4. introduce `SurfaceAnalyzerSession` as a facade only
5. move filter/domain ownership behind the session
6. move/reuse topology behind the session
7. move/reuse SR/FR behind the session
8. move/reuse scanner/RR behind the session
9. centralize persistence behind adapter
10. migrate browser callers to session
11. replace polling/wrapper synchronization incrementally with explicit events
12. consolidate RR presentation
13. remove obsolete compatibility globals only after all consumers migrate
14. expose stable programmatic JS API
15. add thin local Node HTTP adapter
16. validate staging against frozen production
17. promote only after full equivalence testing

Each milestone must be independently testable and bisectable.

If a regression appears, isolate/revert the new milestone first. Do not patch unrelated modules to compensate for it.

## 18. Acceptance requirements

### Research equivalence

- identical semantic topology
- VolSpike oracle unchanged
- identical filtered domain
- identical SR arrays within a tolerance fixed before extraction
- identical FR arrays / `NaN` locations within the same policy
- identical scan masks
- identical semantic scan regions
- identical RR membership
- identical RR geometry
- identical RR metric values within fixed tolerance
- identical inversion behavior

Discrete outputs compare exactly. Numeric tolerances must be chosen before a module is refactored and may not later be loosened to make a refactor pass.

### Browser equivalence

- package upload/load
- persisted restore
- Hard Reset
- Performance mode
- Structural Robustness mode
- Facet Replication mode
- Axis Layers
- Surface Filter
- Auto Format
- Scan Layer
- Clear Applied
- Reset
- Regional Robustness
- RR outlines / table / labels
- no extra reload requirement
- no boot race

### Architecture acceptance

- one canonical session owns the research lifecycle
- pure research modules do not read DOM
- pure research modules do not read localStorage/IndexedDB
- one topology identity/cache is shared by session consumers
- research and presentation state are separate
- cache invalidation is explicit
- UI cannot redefine research domain
- browser and local API use the same engine

## 19. Baseline regression assets

`tests/baseline-regression.cjs` is the first lightweight regression harness. It covers:

- the existing generic semantic synthetic suite
- the historical VolSpike topology oracle:
  - 6 hard surfaces
  - 160 disconnected facet components
  - 183,520 undirected semantic edges
  - 0 missing expected neighbors
- scanner percentile semantics
- scanner semantic connectivity / minimum-region behavior
- scanner evaluation smoke behavior
- RR performance-only region behavior / boundary raw deterioration smoke behavior

The repository currently does not contain the canonical Volume Bands or semantic VolSpike `.surface.zip` production fixtures.

Those packages must be supplied as existing real fixtures before package-level SR/FR/scan/RR snapshot equivalence can be considered complete. Synthetic fixtures supplement production fixtures; they do not replace them.
