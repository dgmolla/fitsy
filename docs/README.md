# Fitsy Docs

Index of all documentation. Restructured 2026-06-12 (see [`docs-refactor-proposal-2026-06-11.md`](docs-refactor-proposal-2026-06-11.md) for the audit that drove it).

## Conventions

- **Domains** are the children of `docs/`: `product/`, `engineering/`, `design/`, `gtm/`. Subdirs are grandchildren.
- **Status header** — living docs carry `> **Status:** living · **Last verified:** YYYY-MM-DD` near the top. Specs use `active-spec` / `proposed`; shipped surfaces use `shipped`.
- **`archive/`** — every domain has one. Superseded or completed-one-off docs move there with an `ARCHIVED` banner pointing at their replacement. **Read for history; never update.**
- **Diagrams** — every spec/design doc includes at least one Mermaid diagram (GitHub + Obsidian render natively).
- **Ownership** — each doc tree is owned by an agent role (`.claude/agents/<role>.md`). See "You Own" there.

## Product — `product/`

| Doc | What it is |
|-----|-----------|
| [vision.md](product/vision.md) | Product vision: problem, target user, value prop, what's shipped |
| [roadmap.md](product/roadmap.md) | Phased roadmap (Phase 1 shipped → Phase 2/3 features) |
| [business-model.md](product/business-model.md) | RevenueCat + Apple IAP monetization + **Pricing Decision Record** |
| [app-store-listing.md](product/app-store-listing.md) | App Store Connect metadata/copy (live) |
| [pre-launch-action-items.md](product/pre-launch-action-items.md) | **Canonical** pre-launch blocker tracker |
| [competitors.md](product/competitors.md) · [feedback-triage.md](product/feedback-triage.md) | Market analysis · feedback ops |
| `specs/` | [check-in-local-legend](product/specs/check-in-local-legend.md) · [merchant-dashboard](product/specs/merchant-dashboard.md) · [meal-tweak-suggestions](product/specs/meal-tweak-suggestions.md) · [community-feedback-forum](product/specs/community-feedback-forum.md) · [landing-page](product/specs/landing-page.md) · [llc-formation](product/specs/llc-formation.md) · [TEMPLATE](product/specs/TEMPLATE.md) |

## Engineering — `engineering/`

**`architecture/`** — living system docs
- [system-design.md](engineering/architecture/system-design.md) — overall two-system architecture
- [auth.md](engineering/architecture/auth.md) — end-to-end auth (Apple/Google via Supabase, JWKS)
- [api-reference.md](engineering/architecture/api-reference.md) — routes + current LATERAL/denormalized query model
- [analytics-events.md](engineering/architecture/analytics-events.md) — PostHog event taxonomy
- [testing-strategy.md](engineering/architecture/testing-strategy.md)

**`pipeline/`** — UE-first preload pipeline
- [ue-first-pipeline.md](engineering/pipeline/ue-first-pipeline.md) — primary design (Uber Eats discovery)
- [runbook.md](engineering/pipeline/runbook.md) — operations (`scripts/preload-ue-first.ts --phase …`)
- [macro-accuracy-recommendations-2026-08-16.md](engineering/pipeline/macro-accuracy-recommendations-2026-08-16.md) — accuracy/model decisions (latest)
- [open-model-spike-2026-07-20.md](engineering/pipeline/open-model-spike-2026-07-20.md) — eval evidence log
- [canonical-chain-macros.md](engineering/pipeline/canonical-chain-macros.md) — Brand/ChainItem canonical design
- Superseded (in `engineering/archive/`): data-pipeline-v3, status, baseline-v6, macro-accuracy-handoff-2026-08-16, phase1-extraction-execution

**`backend/`** — [perf-and-security-handoff](engineering/backend/perf-and-security-handoff-2026-04-25.md) · [api-perf-followups-spec](engineering/backend/api-perf-followups-spec.md) · [idempotent-preload-spec](engineering/backend/idempotent-preload-spec.md) · [security-audit-sprint10](engineering/backend/security-audit-sprint10.md) · [rls-policies-parked.sql](engineering/backend/rls-policies-parked.sql)

**`devops/`** — [production-deployment](engineering/devops/production-deployment.md) · [staging-environment](engineering/devops/staging-environment.md) · [monitoring-alerting](engineering/devops/monitoring-alerting.md) · [costs](engineering/devops/costs.md) · [ios-release-runbook](engineering/devops/ios-release-runbook.md)

**`archive/`** — historical ticket specs, spikes, and superseded specs.

[tuning-guide.md](engineering/tuning-guide.md) — Shipyard Settings knobs (referenced by `CLAUDE.md`)

## Design — `design/`

[design-brief.md](design/design-brief.md) · [component-library.md](design/component-library.md) (+ implementation-status / design-debt tracker)

## GTM — `gtm/`

- [la-rollout.md](gtm/la-rollout.md) — LA-only launch: trainer program, Meta test, feedback loop, weekly ritual, exit criteria
- [strategy.md](gtm/strategy.md) — positioning, channel portfolio, growth flywheel
- [ugc-playbook.md](gtm/ugc-playbook.md) — end-to-end UGC creator pipeline + content hook library
- [seo-discovery.md](gtm/seo-discovery.md) — organic / LLM discovery (llms.txt, programmatic SEO, JSON-LD)

