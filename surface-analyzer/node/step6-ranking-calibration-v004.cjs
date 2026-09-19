'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-ranking-calibration-v004.json');
const V003_POLICY_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-calibration-v003.json');
const V003_RESULT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-envelope-calibration-result-v003.json');
const OUTPUT_PATH = path.join(ROOT, 'policies', 'exploratory', 'step6-ranking-calibration-result-v004.json');
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const compareText = (a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
const fail = message => { throw new Error(message); };

function readBound(pathname, expected, label) {
  const bytes = fs.readFileSync(pathname);
  if (expected && sha256(bytes) !== expected) fail(`${label} exact-byte identity mismatch.`);
  return { bytes, value: JSON.parse(bytes) };
}

function membershipIdentity(candidates) {
  const hashes = candidates.map(item => item.membership_sha256);
  if (new Set(hashes).size !== hashes.length) fail('Candidate membership list contains duplicates.');
  return sha256(Buffer.from(`${hashes.join('\n')}\n`, 'utf8'));
}

function rank(candidates, weight, tolerance, shortlistTarget) {
  const ranked = candidates.map(candidate => ({
    membership_sha256: candidate.membership_sha256,
    score: weight.performance * candidate.performance.score + weight.stability * candidate.stability.score,
    components: {
      performance_score: candidate.performance.score,
      stability_score: candidate.stability.score,
      breadth_score_diagnostic_only: candidate.breadth.score,
      weights: { performance: weight.performance, stability: weight.stability, breadth: 0 }
    }
  })).sort((a, b) => b.score - a.score || compareText(a.membership_sha256, b.membership_sha256));
  let groupScore = null, groupRank = 0;
  return ranked.map((item, index) => {
    if (groupScore === null || Math.abs(groupScore - item.score) > tolerance) { groupScore = item.score; groupRank = index + 1; }
    return { ...item, rank: groupRank, shortlisted: groupRank <= shortlistTarget };
  });
}

function topThreeSensitivity(runs, shortlistTarget) {
  const sets = runs.map(run => new Set(run.ranking.filter(item => item.rank <= shortlistTarget).map(item => item.membership_sha256)));
  const union = new Set(sets.flatMap(set => [...set]));
  const intersection = sets.length ? new Set([...sets[0]].filter(hash => sets.every(set => set.has(hash)))) : new Set();
  const pairwise = [];
  for (let left = 0; left < sets.length; left++) for (let right = left + 1; right < sets.length; right++) {
    const both = [...sets[left]].filter(hash => sets[right].has(hash)).length;
    const either = new Set([...sets[left], ...sets[right]]).size;
    pairwise.push({ left: runs[left].weight_id, right: runs[right].weight_id, jaccard: either ? both / either : 1 });
  }
  return {
    union_membership_sha256: [...union].sort(compareText),
    intersection_membership_sha256: [...intersection].sort(compareText),
    identical_across_weights: sets.every(set => set.size === sets[0].size && [...set].every(hash => sets[0].has(hash))),
    pairwise_jaccard: pairwise,
    mean_pairwise_jaccard: pairwise.length ? pairwise.reduce((sum, item) => sum + item.jaccard, 0) / pairwise.length : 1
  };
}

function rankRangeSensitivity(runs) {
  const byHash = new Map();
  for (const run of runs) for (const item of run.ranking) {
    if (!byHash.has(item.membership_sha256)) byHash.set(item.membership_sha256, []);
    byHash.get(item.membership_sha256).push(item.rank);
  }
  const candidates = [...byHash].map(([membership_sha256, ranks]) => ({ membership_sha256, minimum_rank: Math.min(...ranks), maximum_rank: Math.max(...ranks), rank_range: Math.max(...ranks) - Math.min(...ranks) }));
  return {
    candidates,
    mean_rank_range: candidates.length ? candidates.reduce((sum, item) => sum + item.rank_range, 0) / candidates.length : 0,
    maximum_rank_range: Math.max(0, ...candidates.map(item => item.rank_range))
  };
}

function summarizeExistingRuns(runs, shortlistTarget) {
  const normalized = runs.map(run => ({ weight_id: run.weight_id, ranking: run.ranking }));
  return { top_three: topThreeSensitivity(normalized, shortlistTarget), rank_ranges: rankRangeSensitivity(normalized) };
}

function compareSensitivity(v003, v004) {
  const jaccardDelta = v004.top_three.mean_pairwise_jaccard - v003.top_three.mean_pairwise_jaccard;
  const meanRankRangeDelta = v004.rank_ranges.mean_rank_range - v003.rank_ranges.mean_rank_range;
  let interpretation = 'MIXED_OR_UNCHANGED';
  if (jaccardDelta >= -1e-12 && meanRankRangeDelta <= 1e-12 && (jaccardDelta > 1e-12 || meanRankRangeDelta < -1e-12)) interpretation = 'REDUCED';
  else if (jaccardDelta <= 1e-12 && meanRankRangeDelta >= -1e-12 && (jaccardDelta < -1e-12 || meanRankRangeDelta > 1e-12)) interpretation = 'INCREASED';
  return { mean_pairwise_top3_jaccard_delta: jaccardDelta, mean_candidate_rank_range_delta: meanRankRangeDelta, interpretation };
}

function buildArtifact() {
  const policyBound = readBound(POLICY_PATH, null, 'v004 policy');
  const policy = policyBound.value;
  if (policy.frozen !== false || policy.authoritative !== false || policy.scope.breadth_ranking_weight !== 0) fail('v004 must remain an unfrozen scoring-only calibration with zero Breadth ranking weight.');
  readBound(V003_POLICY_PATH, policy.source_binding.v003_policy_sha256, 'v003 policy');
  const v003Bound = readBound(V003_RESULT_PATH, policy.source_binding.v003_result_sha256, 'v003 result');
  const cases = v003Bound.value.cases.map(calibrationCase => ({
    calibration_case: calibrationCase.calibration_case,
    grids: calibrationCase.grids.map(grid => {
      const roles = {};
      for (const role of ['performance_led', 'stability_led']) {
        const source = grid.roles[role];
        const candidateHashes = source.exact_membership_candidates.map(item => item.membership_sha256);
        const identity = membershipIdentity(source.exact_membership_candidates);
        const rankingRuns = policy.weight_sensitivity[role].map(weight => ({
          weight_id: weight.id,
          ranking: rank(source.exact_membership_candidates, weight, policy.ranking.numeric_tie_tolerance, policy.ranking.shortlist_target)
        }));
        const v003Sensitivity = summarizeExistingRuns(source.ranking_runs, policy.ranking.shortlist_target);
        const v004Sensitivity = { top_three: topThreeSensitivity(rankingRuns, policy.ranking.shortlist_target), rank_ranges: rankRangeSensitivity(rankingRuns) };
        roles[role] = {
          candidate_count: candidateHashes.length,
          candidate_membership_sha256_in_v003_order: candidateHashes,
          candidate_membership_identity_sha256: identity,
          breadth_retained_as_diagnostic: true,
          breadth_ranking_weight: 0,
          ranking_runs: rankingRuns,
          sensitivity: { v003: v003Sensitivity, v004: v004Sensitivity, change: compareSensitivity(v003Sensitivity, v004Sensitivity) },
          shortlist_changes_vs_v003: rankingRuns.map((run, index) => {
            const oldRun = source.ranking_runs[index];
            const oldTop = oldRun.ranking.filter(item => item.rank <= policy.ranking.shortlist_target).map(item => item.membership_sha256);
            const newTop = run.ranking.filter(item => item.rank <= policy.ranking.shortlist_target).map(item => item.membership_sha256);
            const oldSet = new Set(oldTop), newSet = new Set(newTop);
            return {
              v003_weight_id: oldRun.weight_id,
              v004_weight_id: run.weight_id,
              retained: oldTop.filter(hash => newSet.has(hash)),
              removed: oldTop.filter(hash => !newSet.has(hash)),
              added: newTop.filter(hash => !oldSet.has(hash)),
              v003_top_three: oldTop,
              v004_top_three: newTop
            };
          })
        };
      }
      return { grid_id: grid.grid_id, roles };
    })
  }));
  return {
    schema_version: 4,
    artifact_type: 'step6_scoring_only_ranking_calibration',
    policy_origin: 'post_result_exploratory',
    authoritative: false,
    v004_policy_frozen: false,
    step7_handoff_frozen: false,
    source_v003_policy_sha256: policy.source_binding.v003_policy_sha256,
    source_v003_result_sha256: policy.source_binding.v003_result_sha256,
    policy_id: policy.policy_id,
    policy_version: policy.policy_version,
    policy_sha256: sha256(policyBound.bytes),
    ranking_formula: policy.ranking_formula,
    cases
  };
}

function main() {
  const artifact = buildArtifact();
  const bytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_PATH, bytes);
  process.stdout.write(`${JSON.stringify({ output: OUTPUT_PATH, artifact_sha256: sha256(bytes), policy_sha256: artifact.policy_sha256, cases: artifact.cases.map(item => ({ calibration_case: item.calibration_case, grids: item.grids.map(grid => ({ grid_id: grid.grid_id, performance_candidates: grid.roles.performance_led.candidate_count, performance_sensitivity: grid.roles.performance_led.sensitivity.change.interpretation, stability_candidates: grid.roles.stability_led.candidate_count, stability_sensitivity: grid.roles.stability_led.sensitivity.change.interpretation })) })) }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { membershipIdentity, rank, topThreeSensitivity, rankRangeSensitivity, compareSensitivity, buildArtifact };
