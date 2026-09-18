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

## Exploratory successor bindings

Descriptor-changing repackages receive immutable successor policy files even when interpretation semantics remain compatible. These exact-byte identities are frozen:

| Policy | Descriptor binding | Exact-file SHA-256 |
|---|---|---|
| `policies/exploratory/volume-bands-surface-policy-v002.json` | `a42eaa80f7eb7a00934b9a5fe2f9a22869034915ee62e0541ea9b173006ddeab` | `82fb304f1f1a1e776690bc5b9914477bfd6cb9026dcccfbcb58f18769c9bfd5b` |
| `policies/exploratory/volume-bands-surface-policy-v003.json` | `2367a68db624d87822a552e9465a64058705694f66ca50fa3072f9e80f529c2c` | `78675f077f827fe3c7908fa33a599593a8e6eda439447f5e3e847c3ba04a2c1b` |
| `policies/exploratory/volume-bands-surface-policy-v004.json` | `f3322fb51058b63be155247ad095bc2099a1acea3013c07b8173215336c30337` | `92ee5dbdc245aa6f736d361c7c40570d9aaecfff8720a6e1f54145e16aa09e33` |

Policy v003 records the descriptor's original empty-string no-filter token. Policy v004 binds the shoulder-expanded package after that value was normalized to the explicit `"None"` token. Do not edit or reformat these files in place.
