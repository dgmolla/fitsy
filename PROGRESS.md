**TL;DR:** Extending PR #558 with verified measured-menu seeds while preserving the frozen v1 population.

# Eval suite seed extension

## Scope and ownership

The existing Codex task owns `data/eval-suite-v1` in `/Users/dawitmolla/fitsy-eval-suite` and PR https://github.com/dgmolla/fitsy/pull/558.
The human authorized source verification, small committed changes, dev-only evaluation, push, current-head CI and independent local AI review, then ordinary squash merge only when green without P0/P1 findings.
No GitHub project board edits are authorized.
`/Users/dawitmolla/fitsy-pdf-match` at `data/pdf-match-scope` is read-only; `/Users/dawitmolla/fitsy-refactor` must not be modified, including reviewer state and attributes.
No hook bypasses, admin merge, database commands or Anthropic calls are permitted.
Normal post-merge deploy automation is authorized; this change must add no migrations or production writers.

## Starting evidence

- Both task worktrees were clean at entry.
- Existing suite head: `bbd8ce41c92dfcbc33eb39d1f3783245b7e57eb9`.
- Existing PR #558 is open on this branch.
- The cumulative spend ledger has 2,957 reservations and 2,957 settlements, no pending or unknown usage, and **$0.10539795** spent.
- The cumulative hard cap is $5; the existing collector stops at $4.50.
- Existing dev/holdout sizes: curated 204/116; bulk 2,508/1,134.
- Claim Jumper remains entirely holdout-only; old serving, case and candidate assignments must be preserved.
- The source measurement contains 259 UE items across Wahoo's, Claim Jumper and Old Spaghetti Factory.
- Source reports 17 multi-row OSF hits plus one multi-row Claim Jumper hit; title equality alone is not ground truth.

## Evidence plan and next action

Read the source measurement and official documents, then record reviewed bindings, explicit candidate-relative negatives and item-level exclusions.
Copy only required source evidence into this checkout, add optional row tags without targets leaking into adapters, and extend splits without moving existing cases.
Regenerate fixture artifacts and the human case list using their generators; record old/new checksums and preservation checks.
Exercise the actual dev runner on affected/new cases, replay any identical previously paid requests, and retain additive billing history.
Run focused tests and cheap gates, freeze committed source, obtain exact-head independent review, push normally, and follow current-head CI through authorized integration.
If reviewer input exceeds the installed limit, report it and retain the failure without altering the reviewer.

## Workflow and resource notes

Using the human-selected standalone `ship-branch` skill and its Fitsy/cutover references.
No mobile, database, scraper or pipeline runtime is needed for offline seed construction.
Use the existing installed local review publisher; do not create another review pipeline or modify the protected checkout.
Record each material checkpoint and the next action here before yielding or ending the session.

## Seed construction checkpoint

Copied the measurement and three successful UE captures from source head `3e8f13afb05f8aba0fc10744484c5d1d023fc6ce`, retaining their SHA-256 identities.
The explicit source-first plan admits 176 observations (Wahoo's 61, Claim Jumper 20, OSF 95) and excludes 83 (18/54/11), with item-level reasons in the fixture manifest.
All 17 OSF multi-row hits, seven gluten-sensitive hits and 12 catering folded-title hits are included; these sets overlap.
Excluded catering garlic bread and the extra Claim Jumper potato collision after checking their ambiguous serving evidence.
The official-source checker verifies 118 selected rows against 28 physical PDF pages and labelled OSF HTML cards; seven references already existed, and 111 are new.

The extension adds **480 cases**, making 4,442 total: curated matching 224, curated macro 178, bulk matching 3,702 and bulk macro 338.
The complete original 3,962 case objects, including candidate lists and splits, compare equal to the starting commit.
Dev/holdout counts are now curated matching 143/81, curated macro 112/66, bulk matching 2,538/1,164 and bulk macro 214/124.
All 27 focused tests, scripts lint/type checks, source verification and fixture/case-list reproduction pass locally.
There are 295 new dev cases and 91 existing dev matching cases whose projected candidates acquire source tags.
Next: add exact-request paid-call replay and an explicit affected-dev selection, then run both methods only on that selection from committed source.
No new paid requests, database commands, Anthropic calls, source-checkout writes, protected-checkout writes or project board edits have occurred.
