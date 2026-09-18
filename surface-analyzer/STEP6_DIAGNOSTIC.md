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
- Two P13 → P14 splits retain only 2.1% and 3.2% of the 1,502-cell parent envelope. The P15 → P16 splits retain 13.4% and 16.8% and also reduce RR boundary separation.
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
