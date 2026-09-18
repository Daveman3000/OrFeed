# Step 4: connected performance qualification

Status: **frozen post-result exploratory policy**, not confirmatory evidence. The exact-byte policy is `policies/exploratory/performance-qualification-step4-v001.json`; its SHA-256 is recorded below. Do not reformat or edit it in place. A change requires a new policy version and a full deterministic rerun from P1.

Step 4 consumes a predeclared, frozen cleaned IS domain. It overlays strict 3/3 performance masks for R/trade, PF, and ROMAD; it does not delete cells from that domain. Near-P1 belongs exclusively to Step 3. DD (a positive R-magnitude in these packages) and win rate are descriptive, not qualification gates. Step 5 evaluates terminal qualified anchors with the **entire cleaned-domain graph** still present around them.

The common ladder starts at P1 = `0.50 / 1.50 / 2.0` and advances by `+0.25 / +0.25 / +1.0`, calculated directly from the rung index, through a fixed P20 safety rail (`5.25 / 6.25 / 21.0`). Each cell must have finite qualification metrics and at least 20 trades. Inside each fixed descriptor regime/facet context, a component is supported when it has at least `max(16, min(32, ceil(0.005 × context P1 cells)))` connected cells. Cell count is geometric support, never a count of independent trades.

At each rung, connected components are built only inside their supported parent lineage, using descriptor-defined one-step ordered adjacency with no bridging across missing cells. A split makes the parent ancestry-only; each supported child proceeds separately. A branch anchors at its highest supported rung when its next 3/3 rung is empty or loses support. If it remains supported at P20, record `MAX_RUNG_REACHED` and `right_censored: true`; do not move the cap. Only terminal supported branches are candidates. A failed or unsupported next rung never moves the RR anchor.

At each parent-to-next-rung transition, record 3/3 supported and unsupported components, connected exactly-2/3 residuals, connected sole-blocker residuals for each metric, multi-blocker counts, and the lineage outcome. Use the same graph and support requirement for the diagnostics, but **2/3 never qualifies, creates a candidate, or changes an anchor**. Residuals from distinct parents must not be connected together.

## Exploratory calibration evidence

The P1→P20 read-only diagnostic used the unmodified Volume Bands cleaned domain (311,150 retained cells; cleaned-domain identity `cbc46330f2492ab7ef4a6cedfd755b5e657001aec3e0c17205576125e48374c2`) and the original, **not Step 3-pruned**, 56,000-cell VolSpike package. VolSpike's CSV `trades` and `win_pct` columns were read for diagnostics without changing its stored package or descriptor. Package SHAs were respectively `c0b730c5712b3bfcad1175e55658ce0054b3011d6c6f43a5181aaf0d3d7ac4f4` and `58834e2326accb4a1a5af72c1da3f04624f22d0b5bc4c9fbdfdec282c81728d5`.

| Surface | Evaluable cells | P1 cells | Supported P1 components | Terminal branches | Highest supported class | P20 censored |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| VolSpike | 28,769 | 5,373 | 71 | 71 | P6 | 0 |
| Volume Bands | 307,575 | 255,581 | 4 | 7 after splits | P16 | 0 |

VolSpike terminal classes: P1 29, P2 13, P3 8, P4 13, P5 6, P6 2. Volume Bands terminal classes: P10 1, P13 2, P14 2, P16 2. Four Volume Bands lineages had still been supported at the earlier P10 cap; all ended naturally before P20. The step from P10 to P20 changed only the cap, not P1, support, increments, or context semantics. `NATURAL_TERMINAL` includes both extinction and loss of minimum component support; it does not imply that no individual next-rung cell passed.

These are descriptive calibration results from previously inspected surfaces, not fresh validation of economic thresholds or predictive performance. The seven terminal Volume Bands anchors are now materialized in `policies/exploratory/volume-bands-step4-frozen-anchors-v001.json` and verified by the read-only exact-anchor evaluator in `node/frozen-anchor-v001.cjs`. The exploratory SR/FR/RR measurements are in `policies/exploratory/volume-bands-step5-anchor-evidence-v001.json`. The evidence file binds the exact bytes of the anchor artifact; Step 5 reads and verifies those stored memberships rather than regenerating Scan regions. The package, descriptor, surface policy, cleaned-domain identity, Step 4 policy, and topology-engine version are bound. No robustness thresholds or adjudication classes are defined.

Policy SHA-256 (exact UTF-8 file bytes): `f1d959ffc44d47683f06e4585cf2b761d849d13013c0ba735f20ccfcdc784e55`.
