# Jev decision result (#503, October 24, 2026)

**TL;DR:** Exact aliases scored 99% accuracy; Jev remains unmeasured pending the required pre-call commit.

| Method | Correct / 200 | False matches / negatives | Recall | Provider cost / 1k pairs | Median / p95 latency |
| --- | --- | --- | --- | --- | --- |
| Current exact alias | 198 / 200 (99.00%) | 0 / 104 (0.00%) | 94 / 96 (97.92%) | $0.00 | 0.0035 / 0.0089 ms |
| Jev latest | Not measured | Not measured | Not measured | Not measured | Not measured |

This is one local sequential Node 24.3.0 pass on 200 supplied candidate pairs from captured LA WaBa Grill and Yoshinoya variants.
The 18.72 ms one-time index build is recorded separately from lookup latency.
The two false negatives are Chicken Bowl in Rice Bowls and Featured items; the independently reviewed Chicken section is already aliased.
The dataset contains 96 positive and 104 negative pairs, with 100 contextual variants per brand.
Baseline dollars describe incremental provider charges; they exclude CPU and infrastructure costs.

The frozen protocol requires at least 95% accuracy without baseline regression, at most 1% empirical false positives and false discoveries, at least 95% recall with a two-percentage-point gain, at most $0.10 per 1k pairs and p95 latency at most 1 second.
Abstentions, incomplete runs or unknown cost cannot pass.
The [protocol](jev-chain-match-eval.md) defines the prompt, confidence cutoffs, sampling and limits.

Recommendation: **NO-GO for production adoption; the Jev comparison is pending, not a failed model threshold.**
The explicit instruction not to commit conflicts with acceptance requiring a committed labeled set and thresholds before any model calls, so no Jev requests were sent.
Resume after an authorized commit of the frozen inputs and code, using the documented live command with existing provider access.
Even a passing comparison supports only a larger offline evaluation; two unaliased positives and largely straightforward negatives cannot establish coverage gains across 94k unmatched rows.
Zero false matches in 104 negatives does not establish a population false-match rate below 1%.

Raw evidence: [per-item baseline decisions](../../../scripts/eval/results/issue-503-baseline/baseline.json), [machine-readable summary](../../../scripts/eval/results/issue-503-baseline/summary.json), and [generated comparison page](../../../scripts/eval/results/issue-503-baseline/report.md).
The benchmark SHA-256 is `90c2ac7d65055231f6367274c2bde0ed036a0ae258475f05674b422db27e3259`.
Jev raw outputs do not exist because the live run has not occurred.

## Live Jev result (2026-10-26)

**Verdict: NO-GO.** Frozen commit `8e289c1`, model returned `jev-1.14.0`, raw journal in `scripts/eval/results/jev-chain-match-2026-10-26/`.

| Method | Accuracy | FP rate | Recall | Abstained | USD / 1k pairs | p95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| Exact alias | 99.0% | 0% | 97.9% | 0 | $0 | <0.01 |
| Jev | 51.5% | 0% | 1.0% | 62 | $0.025 | 124 |

Jev made 1 true match, 102 correct rejections, 0 false matches, 35 missed matches and 62 abstentions (below the frozen 0.95/0.90 thresholds). It passes cost, latency and false-match bars but fails accuracy, recall, recall gain and complete coverage. Total run cost $0.005.
