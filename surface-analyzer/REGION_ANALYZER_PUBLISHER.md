# Region Analyzer publisher

The publisher converts frozen research artifacts into static browser assets. It does not change or regenerate research membership, evidence, policies, rankings, or shortlist state.

Run the first approved publication with:

```bash
node surface-analyzer/node/region-analyzer-publisher-v001.cjs publish-volume-bands
```

The command publishes `volbands_20260918_bandtp_shoulder_winpct_v1-region-analyzer-v001` under `surface-analyzer/region-analyzer/`:

- `catalog.json` is the mutable availability/status index;
- `versions/<sha256>.manifest.json` is the immutable manifest;
- `bundles/<sha256>.masks.bin` is the immutable mask bundle.

Every region mask uses the physical package canonical index order. Masks contain one bit per physical cell, LSB-first within each byte, with zero padding in the final byte. Region masks are concatenated in membership-hash order. A package-plus-mask publication prefixes a cleaned-domain bitset and must prove every region is its subset. The first rectangular Volume Bands publication records `ALL_PHYSICAL_CELLS` and therefore needs no domain-mask segment.

Normal publishing treats the content-addressed 2.1 MB mask bundle as its sole Stage-4 membership input. It validates the exact bundle hash, byte length, mask order, zero padding, and each mask's stored cell count, then emits only the immutable manifest and mutable catalog. It never opens a surface package or CSV and never loads analyzer, session, topology, metric, SR, FR, or RR machinery.

Mask regeneration is not a publisher operation. Any future regeneration must be a separately named, explicitly invoked deep-materialization command with its own tests; normal publishing and normal publisher regression must never call it.

The manifest contains all 55 unique Volume Bands Stage-4 envelopes. Dedicated Step-5 evidence is authoritative for the seven terminal anchors. The other 48 envelopes reference stored trajectory evidence; that source does not retain the full SR decomposition or final profile, so the manifest records those fields as unavailable rather than recomputing them.

Step 6 remains calibration-only. The manifest retains all three performance and stability weight runs, stable intersections, unions, independent role eligibility, and an empty frozen shortlist. The browser must verify every bound identity and may only render stored masks and annotations; research recomputation and best-effort remapping are forbidden.

Publishing the same version is idempotent. A version ID may not resolve to different immutable content; changed research output requires a new version ID. Hiding or staling a version changes only `catalog.json` and does not delete immutable assets.
