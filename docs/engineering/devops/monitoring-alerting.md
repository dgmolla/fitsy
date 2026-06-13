# Monitoring and Alerting

> **Status:** Living · **Last verified:** 2026-06-12
> **Author:** CTO
> **Originally drafted:** 2026-03-24 (Sprint 5 — S-33) · refreshed 2026-06-12

---

## Problem

Production Fitsy needs observable signals to detect problems before users notice:
1. **API health** — is the backend responding?
2. **Error rates** — are requests failing unexpectedly?
3. **Pipeline telemetry** — did the preload run succeed, how many restaurants/items, and what did it cost?
4. **Pipeline alerts** — proactive Slack notifications on failures and completions
5. **Vercel analytics** — basic traffic and performance telemetry

With no monitoring, production incidents are invisible until a user reports them.

---

## Solution

Monitoring stack combining Vercel-native tooling with Axiom pipeline telemetry and Slack alerting:

| Signal | Tool | How |
|--------|------|-----|
| Health | `/api/health` endpoint | Vercel uptime monitoring can ping this |
| Error rates | Vercel function logs | `console.error` captured automatically |
| Error alerts | Vercel Alerts | Email on function error spike |
| Analytics | Vercel Analytics | `@vercel/analytics` + Speed Insights |
| Pipeline telemetry | Axiom dataset `fitsy-pipeline` | `AXIOM_TOKEN` env var; emitted by `PipelineEmitter` in `scripts/preload-ue-first.ts` |
| Pipeline alerts | Slack channel `C0ASM3865AA` | `notifySlack()` helper in `scripts/preload-ue-first.ts` via `SLACK_BOT_TOKEN` |

> **Note:** stdout cost summary is no longer the only or primary signal for pipeline runs. Axiom is the authoritative source for run history, per-hex telemetry, and cost totals. Slack alerts provide real-time visibility on failure and completion without requiring manual log review.

---

## Diagrams

```mermaid
graph TD
    subgraph "Runtime Monitoring (Vercel — fitsy-api project)"
        Client[Mobile App] --> API[API Routes]
        API --> Health[/api/health]
        API --> Logs[Vercel Function Logs]
        Logs --> EmailAlerts[Vercel Email Alerts]
        Analytics[Vercel Analytics] --> Dashboard[Analytics Dashboard]
    end

    subgraph "Pipeline Telemetry (Axiom + Slack)"
        Preload[scripts/preload-ue-first.ts] --> PipelineEmitter[PipelineEmitter]
        PipelineEmitter --> Axiom[(Axiom dataset: fitsy-pipeline)]
        Preload --> notifySlack[notifySlack helper]
        notifySlack --> SlackChannel[Slack channel C0ASM3865AA]
        Preload --> Stdout[stdout cost summary]
    end

    subgraph "Credentials"
        AXIOM_TOKEN[AXIOM_TOKEN env var] -.-> Axiom
        SLACK_BOT_TOKEN[SLACK_BOT_TOKEN env var] -.-> notifySlack
    end
```

---

## Approach

### 1. Health endpoint (`/api/health`)

`GET /api/health` — returns `200` with DB status and build info. Used by:
- `scripts/verify-prod.sh` smoke test
- Future: Vercel cron-based uptime monitor, external uptime services

Response schema:
```json
{
  "status": "ok",
  "db": "connected",
  "version": "0.1.0",
  "timestamp": "2026-03-24T00:00:00.000Z"
}
```

Returns `503` if DB is unreachable. DB check: `SELECT 1` (fast, exercises the connection without depending on table contents).

### 2. Vercel Analytics

Add `@vercel/analytics` and `@vercel/speed-insights` to the Next.js API project. For an API-only project, Speed Insights attaches to the root layout and tracks Web Vitals. Analytics tracks page views on any marketing/error pages.

Enable in Vercel Dashboard → Project → Analytics → Enable.

### 3. Pipeline telemetry — Axiom dataset `fitsy-pipeline`

The UE-first preload script emits structured telemetry via `PipelineEmitter` to the Axiom dataset **`fitsy-pipeline`**. This is the authoritative source for:

- Per-run and per-hex completion status
- Restaurant and item counts written per hex
- Haiku token usage and estimated API cost
- Discovery statistics (hexes probed, UE feed hits, dedup counts)

**Setup:** Set `AXIOM_TOKEN` in the Vercel/local environment. The pipeline emits automatically when the token is present; if absent, telemetry is silently skipped (runs still succeed, but no Axiom record is written).

**Querying:** Use the Axiom dashboard or APL queries on the `fitsy-pipeline` dataset. Example: filter `runId` to inspect a specific pipeline run.

The stdout cost summary is still emitted at end-of-run for quick inspection, but is not the primary record — it is lost when the terminal session ends.

### 4. Pipeline alerts — Slack channel `C0ASM3865AA`

The preload script calls `notifySlack()` (defined in `scripts/preload-ue-first.ts`) to post run-level notifications to the Fitsy engineering Slack channel `C0ASM3865AA`.

**When alerts fire:**
- Pipeline run completion (success or partial)
- Enrichment errors above a threshold
- Preflight failures (UE probe or Anthropic connectivity)

**Setup:** Set `SLACK_BOT_TOKEN` in the environment. If absent, Slack notifications are skipped; no error is raised.

### 5. Vercel error alerts

Configure in Vercel Dashboard → Project → Alerts:
- **Metric**: Function Error Rate
- **Threshold**: >1% error rate for 5 minutes
- **Channel**: Email to project owner

No code changes required — this is a Vercel dashboard configuration.

---

## Interface

### New route: `apps/api/app/api/health/route.ts`

```typescript
GET /api/health
Response 200: { status: "ok", db: "connected", version: string, timestamp: string }
Response 503: { status: "error", db: "unreachable", error: string }
```

### Pipeline telemetry additions (already implemented in `preload-ue-first.ts`)

- `PipelineEmitter` emits per-hex and per-run events to Axiom (`fitsy-pipeline` dataset) when `AXIOM_TOKEN` is set
- `notifySlack()` posts run summaries to Slack channel `C0ASM3865AA` when `SLACK_BOT_TOKEN` is set
- stdout still prints a cost summary at end-of-run for manual inspection

---

## Constraints

- Health check DB query must complete in <500ms — use `SELECT 1`, not a table count or complex query
- Axiom and Slack are optional dependencies in the pipeline — missing env vars cause silent skip, not a crash
- `AXIOM_TOKEN` and `SLACK_BOT_TOKEN` are pipeline-side secrets; they do not need to be in the Vercel API project (they are only used by `scripts/preload-ue-first.ts`, which runs locally or on a CI runner)
- Analytics requires `@vercel/analytics` ≥2.0 for Next.js App Router compatibility
- There are **two** Vercel projects: `fitsy` (marketing site, fitsy.org) and `fitsy-api` (real API). Configure alerts and analytics on `fitsy-api`

## Deployment behavior

`vercel.json` sets `ignoreCommand` to skip builds on all Vercel environments except production:

```bash
if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi
```

Vercel interprets exit 1 as "build this deploy" and exit 0 as "skip." This means:
- **Preview deploys** (PR branches): skipped — no Vercel preview URL generated
- **Development deploys**: skipped
- **Production deploys** (main branch): built and deployed

Rationale: The API project has no meaningful UI to preview in a branch deploy, and skipping previews stays within Vercel's free-tier build quota.

---

## Out of Scope

- Automated cost budget alerts from Axiom (post-MVP — Axiom monitors can trigger this)
- Distributed tracing / OpenTelemetry on API routes
- Custom metrics dashboards beyond Axiom pipeline dataset
- PagerDuty or on-call rotation (Vercel email + Slack is sufficient at current scale)
