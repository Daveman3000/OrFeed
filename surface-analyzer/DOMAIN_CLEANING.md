# Step 3: conservative domain cleaning

Status: **conceptual contract only**. No collector, pruning action, executable threshold, or tuning behavior is authorized by this document. Quantitative calibration on the already-inspected Volume Bands and VolSpike IS surfaces is `post_result_exploratory`; thresholds established there are not confirmatory evidence.

## Purpose and boundary

After the viability and broad-box shoulder stages, clean the final broad IS surface **without rerunning N×M**. Remove only obviously weak macro-regions so the subsequent performance-qualification ladder can work on a credible domain. Cleaning does not identify a winner, set the P1 economic floor, or evaluate SR, FR, or RR. Preserve plausible moderate performers, their ordered neighbors, and comparison peers. When evidence is uncertain, keep the block.

**Decision boundary:** cleaning defines the valid IS search domain from predeclared economic-performance, data-support, semantic-topology, and required-peer evidence. SR, RR, and FR evaluate the surviving valid domain; their values must not be used to propose, justify, tune, or retrospectively validate a cleaning deletion. Preserving peers required for a planned FR comparison is a domain-coverage constraint, not an FR-score optimization. An improved robustness score after cleaning is neither a pruning objective nor proof that the deletion was valid.

The descriptor remains authoritative for hard regimes, facets, activation, tested values, and semantic adjacency. Evaluate weakness within each fixed regime × family context; never pool contexts to justify a deletion. Record the source surface and policy identity, initial analysis domain, each candidate block, the evidence and veto checks, and the resulting filtered-domain identity.

## Allowed candidate shapes and pass budget

Predeclare the candidate generator and order before inspecting cleaning results. The first conservative pass has two distinct diagnostic branches:

1. **Ordered parameters:** contiguous one-dimensional boundary/tail ranges using descriptor-defined adjacency.
2. **Categorical facets/families:** individual values with broadly weak family-level performance, using the categorical family-health audit below. A category has no numeric tail, distance, or ordered neighborhood. Hard regimes remain separate analysis contexts, not categorical values to pool or connect.

After that pass, allow **at most one** simple contiguous two-dimensional ordered-parameter rectangle pass within fixed regime × family contexts. Do not hunt arbitrary shapes, remove individual cells, repeatedly search for a pruneable interaction, or launch a new N×M job as part of cleaning. Candidate geometry must use actual tested/active support, not an inferred Cartesian grid.

## Categorical family-health audit

For each descriptor-defined categorical facet that the surface policy permits comparing, assess each value separately within fixed hard regimes and the other fixed family/context dimensions. Do not let a strong peer value conceal a weak one through pooled summaries. For each legal value/context, report evaluable coverage, joint near-P1/P1 prevalence, the center and upper tail of the relevant performance metrics, and per-cell trade-support distributions. Compare behavior across regimes and contexts without pooling them to justify a deletion.

Where changing only that categorical value leaves a legal, otherwise identical configuration, compare the exact matched peers. Report the direction and magnitude of R/trade and PF differences, the fraction of pairs favoring each value, and disagreements or ties. These comparisons are sensitivity evidence, **not** independent statistical observations or an automatic dominance/pruning rule. If activation or domain support changes when the value changes, identify the unmatched configurations; do not fabricate a pair or infer categorical distance.

Before proposing removal, search for jointly passing, locally connected exception pockets under the same full-context protection mask used below. Report their cell geometry separately from the distribution of per-cell `trades`. Audit whether the category supplies required FR or other comparison peers. An entire categorical value is only a candidate for the common deletion gate when broad weakness is repeatable, no supported exception would be deleted, and required peers remain available. If a supported pocket exists, keep the categorical value; a separately allowed, narrower ordered block may still be assessed without removing that pocket. Uncertainty keeps the value.

Exploratory VolSpike calibration illustrates why both sides of the audit are necessary: `entry_location=0` passed the illustrative near-P1 band in 558/28,000 cells versus 14,876/28,000 for `entry_location=1`, and the matched `1` peer had higher R/trade in 92.8% of legal pairs. Yet some fixed `0` contexts contained connected near-P1 pockets, including one 42-cell component with substantial per-cell trade counts. This is evidence for a categorical audit, **not** an approved deletion, pair-win cutoff, trade floor, or frozen threshold. Source: v2 `nxm_56k_20260911_01.surface.zip`, SHA-256 `58834e2326accb4a1a5af72c1da3f04624f22d0b5bc4c9fbdfdec282c81728d5`.

## Deletion rule and protection veto

For each proposed block, deletion requires **all** of the following:

1. Broad, repeatable **joint** weakness across the block, including a poor center and upper tail, with sufficient finite/evaluable coverage. Missing or invalid metrics are unsupported data, not proof of weak economics.
2. Near-P1 and P1 jointly qualifying cells are rare under the predeclared exploratory rules; metric-marginal quartiles from different cells cannot be assembled into a fictitious good configuration.
3. No meaningful connected neighborhood of **the same cells** jointly satisfies the near-P1 protection rule with valid metrics and adequate per-cell trade support. Build this protection mask in the full current cleaned-domain context, not only inside the proposed block: a qualifying neighborhood that crosses the block boundary also vetoes a deletion that would damage it.
4. The post-deletion topology and facet-peer audit passes. Preserve ordered neighbors and boundary context needed for later SR/RR, and matched facet peers required for any planned FR comparison.

The near-P1 protection predicate has this structure; its numerical requirements remain unfrozen:

```text
protected cell =
    finite, valid R/trade >= near-P1 R/trade requirement
AND finite, valid PF      >= near-P1 PF requirement
AND finite, valid ROMAD   >= near-P1 ROMAD requirement
AND per-cell trades       >= support requirement
```

Only jointly passing cells form protection components under the descriptor's semantic graph. A connected supported component is a veto, not a reason to optimize within that block. Do not scale the veto solely as a percentage of the entire family: a locally meaningful neighborhood may occupy a small fraction of a large combinatorial context. The component-size, shape, finite-coverage, joint-weakness, near-P1/P1 prevalence, trade-support, and ROMAD-validity rules require exploratory calibration before execution.

## Support accounting and outcome

Report **geometric support** (cells, connectedness, ordered extent) separately from **economic/evidentiary support** (the distribution of per-cell `trades`, such as min, median, upper quantile, and fraction above the eventual support floor). Never sum trades across configurations or call cell count an independent sample size; neighboring configurations can reuse the same underlying events.

For every proposed block, record `KEEP` (protection veto, topology/peer veto, insufficient evidence, or uncertainty) or `PRUNE` with its exact broad-weakness evidence and resulting domain change. After each pass, audit retained topology, FR peer coverage where applicable, moderate-performance alternatives, and whether another allowed pass would remove obvious junk rather than useful context. Stop early when another pass would mainly narrow plausible neighborhoods.

The output is a recorded filter over the existing IS surface: **cleaned domain = analysis universe**. Step 4 may then create performance-qualified core masks within that intact cleaned domain; the cleaning filter itself is not a performance-core mask. No actual Volume Bands pruning decision or numeric cutoff is frozen here.
