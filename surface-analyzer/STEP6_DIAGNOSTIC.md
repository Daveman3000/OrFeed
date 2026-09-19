# Step 6 trajectory diagnostic

This is a post-result exploratory diagnostic. It does not choose Step-6 tolerances, freeze a Step-6 policy, select a zone, or rank the performance-led and stability-led paths.

## Mechanics

The diagnostic reconstructs the exact hash-addressed Step-4 lineage memberships and evaluates every unique envelope with the frozen Step-5 evidence definitions:

- performance-led trajectory: traverse the frozen lineage from P1 toward the terminal core;
- stability-led trajectory: traverse the same immutable envelopes from the terminal core toward its broader predecessors;
- SR and FR: aggregate cell evidence against the unchanged full cleaned domain;
- RR: recompute for every distinct envelope membership;
- topology: report ordered spans, induced internal degree, and graph two-core breadth;
- representative sample: choose 24 cells by deterministic farthest-point coverage in normalized ordered-parameter space, without using performance metrics to select cells.

The two directions intentionally share memberships. This exposes the performance/stability trade-off without inventing a Step-6 stability threshold or an alternative region generator.

## Coverage

The materialized artifact contains 78 terminal structures and 228 unique envelopes:

- Volume Bands: 7 terminal structures, 55 unique envelopes;
- VolSpike: 71 terminal structures, 173 unique envelopes.

Every envelope is connected and has a nonempty graph two-core. The existing RR depth statistic is not discriminating for these surfaces: all 173 VolSpike envelopes and 14 later Volume Bands envelopes have every cell on the region boundary. Ordered spans and graph two-core evidence therefore remain necessary alongside RR depth.

## Volume Bands observations

- All 55 envelopes can supply 24 spatially distributed cells, including all seven terminal cores of 32–148 cells.
- SR moves from strong/moderate in broad ancestors to sensitive in every terminal lineage. Minimum-metric SR decreases in 86 of 89 tightening transitions.
- RR is moderate for 42 envelopes and strong for 13, generally becoming strong only at later, tighter rungs.
- The shared 71,001-cell lineage becomes SR-sensitive at P8 and RR-strong at P13. Its P16 branches contain 48 and 60 cells.
- The P13 → P14 split produces one 719-cell main child plus two small 32- and 48-cell children. The small children retain only 2.1% and 3.2% individually; all three children retain 799/1,502 cells collectively (53.2%). The P15 → P16 children retain 13.4% and 16.8% and also reduce RR boundary separation.
- FR becomes divergent-but-economically-viable through much of the later shared lineage, then becomes mixed for one P16 branch because peer coverage falls. Three other terminal branches eventually lose all supported applicable facet evidence.
- Across the deterministic 24-cell samples, the median of the largest absolute sample-versus-zone median deviation is 0.43 zone IQR; the observed range is 0.00–0.64. No acceptability cutoff is applied.

This reproduces the manual warning case directly: later rungs improve the performance class and often strengthen exact-region RR, while local SR and sometimes FR coverage deteriorate and branch size can collapse sharply.

## VolSpike observations

- Only 23 of 71 terminal cores contain at least 24 cells; 48 cannot provide the requested distributed sample.
- Twenty-two P1 terminal lineages never contain 24 cells at any rung. They are explicit breadth failures for the proposed 24-cell question, not automatically rejected research regions.
- Of 173 unique envelopes, 123 can provide 24 cells and 50 cannot. Tightening causes the 24-cell sample to become unavailable in 26 lineage transitions.
- Minimum-metric SR decreases in 94 of 102 tightening transitions. RR interior similarity decreases in 35 transitions and RR boundary separation decreases in 27.
- The smallest observed VolSpike tightening step retains 26.2% of its parent; that same transition loses the 24-cell sample and reduces both SR and RR boundary separation.
- SR across all envelopes is 23 strong, 112 moderate, and 38 sensitive. RR is 4 strong, 59 moderate, and 110 weak.
- FR is economically weak for 98 envelopes, adequate for 31, and divergent-but-economically-viable for 44. None is classified as FR-insufficient because at least one applicable facet remains supported.
- For envelopes where a 24-cell sample is possible, the median of the largest absolute sample-versus-zone median deviation is 0.16 zone IQR; the observed range is 0.00–0.54. No acceptability cutoff is applied.

VolSpike therefore exposes a different failure mode from Volume Bands: many structures begin or end too small for the proposed 24-cell representation, and tightening often reduces local or regional evidence before reaching the terminal performance class.

## What remains unfrozen

The diagnostic deliberately leaves the following decisions open:

- minimum acceptable zone size or graph breadth;
- what sample-versus-zone deviation makes 24 cells representative enough;
- allowed SR, RR, and FR deterioration along either trajectory;
- how sharp a split or contraction constitutes peak collapse;
- whether the performance-led and stability-led paths may stop at different envelopes;
- whether a lineage may preserve both paths into Step 7.

The evidence is sufficient to calibrate those rules next, but this artifact makes no such decision.

## Frozen envelope-selection policy

The global policy in `policies/exploratory/step6-envelope-selection-v001.json` uses only the materialized 228-envelope artifact. It applies the same transition and handoff rules to both surfaces and does not regenerate SR, RR, FR, topology, or sample evidence.

### Frozen evidence-loading and verification contract

The persisted 228-envelope trajectory artifact is the normal Step-6 evidence source. Routine selection and routine regression must load that immutable, hash-addressed artifact; they must not reconstruct unchanged envelopes or recalculate SR, FR, or RR.

Normal regression is a fast integrity and determinism check. It must fail closed unless all of the following hold:

- the exact artifact SHA-256 matches the policy binding;
- the artifact schema and version are supported;
- all 228 unique envelope memberships and all 78 terminal structures are covered;
- the bound dependency identities match, including source package/surface, descriptor, cleaned domain, topology engine, metric definitions and normalization, and SR/FR/RR policy identities;
- the Step-6 selection result is reproduced deterministically from the persisted artifact.

The full 228-envelope reconstruction and SR/FR/RR recalculation is an explicit deep-verification operation. It is required only when a bound identity dependency changes or when a human explicitly requests deep verification. The existing `step6-trajectory-diagnostic-v001.test.cjs` reconstruction test is the deep-verification test and is not part of normal regression. A deep run must reproduce the persisted trajectory artifact exactly before that artifact can be replaced or rebound.

This split changes execution cost only. It does not weaken evidence identity, reproducibility, selection rules, or fail-closed behavior:

```text
normal operation
persisted frozen evidence -> verify identities and coverage -> deterministic selection

dependency change or explicit deep verification
reconstruct 228 envelopes -> recalculate evidence -> exact artifact comparison
```

Performance-led tightening stops before the first transition that enters fewer than 24 cells, retains less than 20% of its parent, loses more than one multi-value ordered dimension, reduces graph two-core fraction by more than 0.15, reduces minimum-metric SR median by more than 0.10, reduces minimum RR interior or boundary evidence by more than 0.15, or materially worsens FR availability/economics. A veto cannot be crossed.

Selected Step-6 handoff envelopes must contain 24–2,000 cells. The lower bound preserves the existing 24-cell distributed-representation question. The upper bound retains the meaningful 1,502-cell Volume Bands envelope but excludes oversized predecessors that would leave localization to Step 7. Within that range, 24–47 cells are minimum breadth, 48–199 are tractable, and 200–2,000 are healthy. These tiers are consolidation evidence, not a size score.

The stability-led rule walks outward from the performance selection and chooses the nearest predecessor at P3 or higher that is within the same 24–2,000-cell range, remains at least SR-moderate and RR-moderate, does not have economically weak or unsupported FR, and materially improves at least one of SR, RR, FR, or topology. `MIXED` FR remains eligible because it is supported evidence rather than economic failure. The rule stops at the first qualifying predecessor and never maximizes stability.

Exact duplicate/shared memberships are merged first. The remaining candidates are compressed independently within each surface by a non-compensating frontier over performance rung, SR band, RR band, FR band, and breadth tier. A candidate is removed only when another candidate is no worse on every axis and strictly better on at least one. There is no arithmetic score: a good-but-smooth zone and a great-but-jagged zone therefore both survive when neither dominates the other. Equal evidence profiles remain distinct unless their exact membership is identical. Strong-overlap percentages are not fabricated because the 228-envelope artifact records hashes and representative samples, not full nonterminal membership sets.

On Volume Bands, the transition rule yields five unique workable performance candidates. Consolidation selects one shared P15 envelope of 357 cells. The broader P13 envelope has the same categorical SR/RR/FR and breadth states at lower performance, so it is dominated rather than retained as a nominal stability alternative. No existing 24–2,000-cell predecessor restores materially better structural credibility; the much broader smooth predecessors are intentionally not handed to Step 7.

The two Volume Bands splits remain explicit. The P13 split produces children of 719, 32, and 48 cells: 799/1,502 collectively (53.2%), while the two minor branches retain only 2.1% and 3.2% individually. The P15 split retains 108/357 collectively (30.3%), but its children retain only 13.4% and 16.8% individually. Collective sibling retention is reported, but it does not override an individual child's collapse. The selected shared P15 parent prevents the final P16 split from replacing the tractable common envelope.

On VolSpike, 22 of 71 lineages never produce a transition-safe envelope with at least 24 cells and remain `TARGETED_RESCAN_REQUIRED`; they are not passed to Step 7. The other lineages yield 51 exact workable candidates after shared-membership consolidation. The non-compensating frontier selects nine distinct zones: seven performance-led and two stability-led, containing 26–115 cells. This compresses the surface to a low-teens handoff without a surface-specific exception or weighted optimization.

Across both calibration surfaces, Step 6 therefore hands Step 7 ten distinct zones: one Volume Bands zone and nine VolSpike zones. The result is a zone-selection artifact only. It does not select exact cells, execute a targeted rescan, or choose live parameters.
