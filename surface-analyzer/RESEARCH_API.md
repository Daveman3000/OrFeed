# Surface Analyzer Research API v1

Status: transport-independent contract for programmatic research access.

The Research API sits above the canonical `SurfaceAnalyzerSession` and below any transport. It contains no HTTP, MCP, Codex, browser, filesystem, or hosted-control-plane assumptions.

```text
surface registry / resolver
        ↓
Research API v1
        ↓
SurfaceAnalyzerSession
        ↓
shared filter / semantic / scan / RR engines
```

## Principles

- A request is reproducible from `surface_id + domain + analysis spec`.
- Domain selections use declared parameter **values**, not UI checkbox indices.
- Each request uses a fresh session by default; no hidden prior browser state participates.
- Responses are compact and JSON-friendly by construction.
- Full scan masks, region-id vectors, metric grids, and other cell-sized arrays are not returned by default.
- Research formulas remain owned by the existing engines/session. The API only resolves inputs, invokes the session, and summarizes outputs.
- Surface storage is external. The API receives `resolveSurface(surface_id)` and optionally `listSurfaces()` adapters.
- A future Node server, Codex runner, MCP adapter, browser client, or hosted control plane must call this same contract rather than reimplementing research logic.

## Envelope

Every successful response includes:

```json
{
  "schema_version": 1,
  "api_version": "surface-research-api-v001",
  "operation": "..."
}
```

Errors are thrown by the core API. Transport adapters decide how to encode them (HTTP status, MCP tool error, CLI exit code, job result, etc.).

## `list_surfaces`

Request:

```json
{"operation":"list_surfaces"}
```

The returned `surfaces` array is supplied by the configured registry adapter. The Research API does not prescribe persistence or discovery mechanics.

## `describe_surface`

Request:

```json
{
  "operation": "describe_surface",
  "surface_id": "volbands_20260917"
}
```

Response includes source identity, study id, rows/cols/configuration count, declared metrics, axis-domain parameter definitions and values, and package provenance.

## `analyze_surface`

Request:

```json
{
  "operation": "analyze_surface",
  "surface_id": "volbands_20260917",
  "domain": {
    "weighting": ["Exponential"],
    "length": [10, 11, 12]
  },
  "structural_robustness": ["r_per_trade"],
  "facet_replication": ["r_per_trade"],
  "scan": {
    "criteria": [
      {
        "id": "performance_floor",
        "enabled": true,
        "source": "performance",
        "metric": "r_per_trade",
        "basis": "raw",
        "operator": ">=",
        "value": 0.25
      }
    ],
    "region_rules": {
      "connectivity": "semantic_ordered_graph",
      "min_cells": 1
    }
  },
  "regional_robustness": true
}
```

The API resolves domain values to the canonical filter engine, then runs requested analyses through a fresh canonical session.

### Compact analysis summaries

SR/FR outputs are summarized with finite count, missing count, min, p10, median, mean, p90, and max. This deliberately avoids returning one value per configuration unless a future explicitly-scoped inspection operation requests it.

### Compact Scan output

Scan output includes passing cells / total cells / passing fraction, criteria, performance metrics, connected-region semantic summaries, and Regional Robustness region summaries when requested. It omits the cell-sized `mask`, `regionId`, and RR mask arrays.

## Reserved next operations

The following are intentionally deferred until their semantics and payload sizes are regression-tested:

- `compare_domains`
- `inspect_region`
- `sample_region`

These should be added as high-level operations rather than exposing raw session internals remotely.

## Surface registry boundary

The next adapter layer should provide at minimum:

```js
resolveSurface(surfaceId) -> semantic surface
listSurfaces() -> compact surface descriptors[]
```

For local research this can be a filesystem-backed registry. A hosted control plane can later reference the same stable `surface_id` values without changing the Research API.
