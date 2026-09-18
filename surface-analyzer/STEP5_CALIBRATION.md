# Step 5 exploratory calibration state

This is descriptive post-result exploratory evidence. It does not define global robustness thresholds, a composite robustness score, or `ROBUST`/`FRAGILE` labels.

## Evidence contract

`policies/exploratory/step5-robustness-evidence-schema-v001.json` keeps the following axes separate:

- Step-4 lineage breadth and persistence;
- SR cell distributions, component decomposition, ordered-dimension directional stability, coverage, and normalization identity;
- FR availability, structural similarity, peer coverage, and peer economics;
- exact-membership RR interior and boundary evidence.

SR/FR cell evidence is reusable only under an unchanged evidence identity and full cleaned domain. A child membership requires new summaries and FR peer/economic aggregation. RR is membership-specific and must be rerun for every changed region.

## Volume Bands

Seven correlated terminal anchors descend from the frozen Step-4 filtration. Their median SR values are generally low despite complete three-step neighbor coverage. The dominant weak direction is `stop_points`: it is the lowest directional-stability dimension for five of seven anchors for each qualification metric. Every anchor occupies the minimum tested stop level. Low SR therefore reflects full-domain local sensitivity, especially across the stop step, rather than missing evidence.

Exact-anchor RR interior similarity is much higher because it evaluates smoothness inside each frozen high-performance core. This is not contradictory: SR asks how each core cell relates to its full-domain neighborhood, while RR also describes the exact core's internal structure and boundary.

## Materialized VolSpike calibration surface

The physical package `volspike_20260911_trades_v1` retains the original 56,000-row `surface.semantic.csv` byte-for-byte and changes only the descriptor representation of `trades` to typed `Int32` sample support.

The cleaned research identity `volspike_20260911_step3clean_trades_v1` is the physical package plus the exact recovered Step-3 mask:

- 91 unique approved prune scopes;
- scope-list SHA-256 `ab3565375414b05626b62245f0ef19db01cf35809e58f57b160f78fc80150e50`;
- 14,805 excluded cells;
- 41,195 retained unique analysis keys;
- zero removals from the known 35-cell tail;
- cleaned-domain identity `3702fce810703a9e885ea53c9b8b101c56fe6355b5dc46744698d612daf65228`.

Fresh Step 4 on the filtered graph produced 71 terminal anchors totaling 1,763 cells: 29 P1, 13 P2, 8 P3, 13 P4, 6 P5, and 2 P6. No terminal result from the original uncleaned 56k calibration was reused.

Compared with Volume Bands, VolSpike has materially higher SR anchor medians but lower and more variable RR interior similarity. Its most frequent lowest directional dimensions are `stop_london_range_percent` and `maximum_trades_per_day`; breadth is also the most frequent lowest SR component. This establishes that low SR is not a universal artifact of the engine: the two surfaces exhibit different dimensional and regional structures under the same evidence definitions.

FR availability also differs by facet. `london_close_beyond_asia` and `pm_close_mode` have matched peers for all 71 anchors. `entry_location` is unsupported for 44 anchors and supported for 27, consistent with the scoped categorical cleaning rather than evidence of failed replication. `reentry_after_stop` is N/A for all terminal anchors under the available active support. Peer availability, similarity, coverage, and P1 economics remain separate evidence fields.

These two surfaces are sufficient to begin exploratory global-band calibration, but the anchors are not independent statistical observations: Volume Bands includes shared lineages, and VolSpike anchors share source data and contexts. Any proposed bands must remain research-policy rules, not significance claims.

## Frozen exploratory adjudication

`policies/exploratory/step5-robustness-adjudication-v001.json` freezes the first global, non-compensating Step-5 policy. It evaluates evidence sufficiency before categorical SR, RR, and FR bands and assigns one of five descriptive profiles. It does not produce a composite score, a robust/fragile verdict, or a selection decision.

The calibration gives Volume Bands and VolSpike equal status as two calibration cases; their anchor counts are not statistical weights. Lineage breadth remains adjacent descriptive performance context and cannot change a robustness profile. Boundary contact is recorded per ordered dimension against the actual fixed-context cleaned domain, including explicit single-value min/max pinning, but it does not automatically upgrade or downgrade SR.

The deterministic 78-anchor result is materialized in `policies/exploratory/step5-joint-calibration-v001.json`:

- Volume Bands: seven SR-sensitive and RR-strong anchors; three are `REGIONALLY_COHERENT_LOCALLY_SENSITIVE`, three are `INSUFFICIENT_EVIDENCE` because their only applicable required facet has no matched peer evidence, and one is `MIXED_AMBIGUOUS` because matched-peer coverage is only 29% despite economically viable peers.
- VolSpike: 42 moderate, 20 sensitive, and nine strong SR anchors; RR is weak for 42, moderate for 25, and strong for four. Fourteen anchors are `LOCALLY_SMOOTH_REGIONALLY_WEAK`; 57 are `MIXED_AMBIGUOUS` once facet economics and the non-compensating profile rules are retained.

An unsupported FR facet is never treated as failed replication. VolSpike anchors remain classifiable when other applicable facets are supported; the unavailable facet is retained explicitly in the decomposition. The profile label is shorthand only, and the full SR/RR/FR evidence remains authoritative.
