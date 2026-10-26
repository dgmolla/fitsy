**TL;DR:** NO-GO; see the frozen threshold verdict below.

| Method | Accuracy | FP / negatives | FP / predicted matches | Recall | USD / 1k pairs | Median / p95 ms | Attempted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Exact alias | 99.00% | 0.00% | 0.00% | 97.92% | $0.0000 | 0.0031 / 0.0057 | 200/200 |
| Jev | 51.50% | 0.00% | 0.00% | 1.04% | $0.0254 | 98.2147 / 124.1408 | 200/200 |

Benchmark SHA-256: `90c2ac7d65055231f6367274c2bde0ed036a0ae258475f05674b422db27e3259`.
Frozen execution commit: 8e289c1592c34cebfa9c06c04b30b4cd8ea8ae90.
Jev models returned: jev-1.14.0.
Verdict: Failed frozen threshold: complete; Failed frozen threshold: accuracy; Failed frozen threshold: recall; Failed frozen threshold: recallGain
Abstentions and missing results count as incorrect; failures never disappear from denominators.
Cost uses reported input tokens at the frozen vendor price; unknown usage is never free.
Pairs are contextual LA menu variants, not independent restaurants or a random LA population sample.
This measures a supplied candidate decision, not candidate retrieval, end-to-end macro accuracy or production coverage.
Raw baseline decisions are retained in baseline.json alongside summary.json.
Live and replay outputs also contain the append-only Jev request/response journal.
