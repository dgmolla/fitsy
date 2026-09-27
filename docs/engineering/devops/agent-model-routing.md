# Model routing and agent delegation

Apply this policy to every Fitsy coordinator, implementation worker and review adapter.
The canonical [shipping procedure](shipping.md) owns validation, review budgets, dispositions and release gates.
Model selection never waives those gates or grants permission to start extra work.

## Model selection

| Work | Default | Boundary |
| --- | --- | --- |
| Implementation, debugging and independent review | Sol | Use the configured available Sol model; record its exact identifier. |
| Narrow classification, summaries and straightforward checks | Luna | Use only when mistakes are low impact and the output can be readily verified. |
| Unresolved ambiguity, difficult architecture or consequential security/data decisions | Stronger capable model | Record the concrete uncertainty, why the default is insufficient, and the bounded decision or task. |
| Review-comment triage experiment | Jev, advisory only | Follow #372; no dismissal, priority rewrite, required verdict or merge authority. |

Choose reasoning effort to match the problem and preserve canonical review-adapter settings.
Do not lower a required review's settings merely to reduce cost.
If a model is unavailable, preserve the checkpoint and use a supported comparable model with the substitution recorded.
Never change reviewers to evade a finding.
Use the least costly suitable model, without trading away correctness or required evidence.
Do not claim an inherited worker uses a cheap model unless its actual configuration is known.
Record unknown model/provider as unknown; model names or elapsed time do not establish measured token cost.

## Ownership and context

Use one implementation owner per task by default and one coordinator for the delivery queue.
Related acceptance work may share one owner and PR; do not create a worker merely because there is another issue number.
Delegate additional agents only for concrete independent work with non-overlapping files or an explicit integration agreement.
Record issue, branch/worktree, owned files, exclusive resources, acceptance, model/provider and next action on the issue or task handoff.
Keep changing status out of these durable instructions.

Reuse an idle worker for related sequential work when its context is still relevant.
Give each assignment a compact current brief with acceptance, constraints, evidence pointers and ownership boundaries.
Start a fresh instance when context is stale, large or unrelated; do not copy a whole conversation by default.
At completion, retain a compact handoff, release owned services and leave the worker idle or stopped rather than polling indefinitely.
Use deterministic schedulers for routine monitoring and notifications instead of waking an LLM for each tick.
Do not pause independent work for another lane's blocker unless there is a real dependency, file conflict or exclusive resource.

## Independent review

The implementer cannot supply its own independent verdict.
Use a fresh read-only review process with the relevant diff, requirements and repository context, without inheriting the implementer's conversation.
The reviewer may use the same model as the implementer; separate context does not eliminate correlated model errors.
Keep deterministic checks and deliberate negative controls as complementary evidence.

Run only the canonical required lenses, with advisory lenses handled by the shipping policy.
Do not add parallel generic reviewers or repeat a valid review solely to gain confidence.
Reuse verdicts only when the canonical identity and context checks allow it.
Charge every executed lens and retry against the shared cumulative review-time budget across repaired versions; preserve all prior history.
A fresh verdict must cover changed review inputs before it can satisfy the final candidate's gates.
Record escalation reason and outcome so model changes can be evaluated against actual retries, quality and delivery time.
