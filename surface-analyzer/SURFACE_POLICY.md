# Surface Policy v001

`policies/surface-policy-v001.schema.json` defines the interpretation-layer contract. `policies/volume-bands-surface-policy-v001.json` is the frozen Volume Bands pilot policy. Neither artifact implements tuning or changes the existing analyzer.

## Identity and authority

- The Volume Bands policy identity is SHA-256 of its **exact UTF-8 file bytes** (no BOM), not canonicalized JSON. Its frozen hash is `190d11df8318d229e32a1dbdb5fce28a6bfadff3b5db29edaaf0662beaeb9aa3`.
- Do not edit or reformat that file in place. A substantive revision requires a new policy version and file; even byte-only changes produce a different identity.
- The policy binds to the SHA-256 of the **uncompressed `surface_descriptor.json` member bytes**: `cccefc3278c545c9aece757090621ff1c34f7ba2c29f8449db6e1a407b958445`. This was checked against the Volume Bands package with package SHA-256 `668afbb8d16edbfeaa2c5b047c4f6fe4e775e1971532c9141dc6371373475551`.
- The descriptor owns parameter IDs, declared values, topology roles, sources, and activation. `descriptor_assertions` are equality checks against it. Any mismatch fails validation; policy never repairs or overrides the descriptor.

## Analysis semantics

- Each `distance_scale_mode` value is a separate hard regime context. Connectivity never crosses regimes. `average_mode` and `weighting_mode` are categorical model-family facets, not ordered edges. Length, ATR ratios, and trade-management points are ordered only within their declared active domains; smoothness and monotonicity are not presumed.
- `cross_family` requires one regime, at least two retained values of **each** facet, common active-parameter support for comparison, and eligible matched facet peers with peer coverage reported for facet replication (FR). `within_family` fixes one value of each facet and does not permit FR. Empty or unmatched peers cannot be counted as replication.
- Regional-robustness membership uses performance criteria; robustness, replication, and risk remain distinct evidence roles. Scope and performance criteria are not interchangeable with topology.
- Before inspecting results, each run must fix and record its policy hash, regime context, analysis scope, and explicit research domain. A scope change after results are visible creates a separately identified exploratory run, not a reinterpretation of the original run.

The schema validates document shape. A consumer must additionally check the descriptor hash and assertions, declared domain values, selected scope requirements, and eligible matched-peer coverage against the bound descriptor and actual research domain. No tuning or representative-selection behavior is specified here.
