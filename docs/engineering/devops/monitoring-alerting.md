# Monitoring and Alerting

> **Status:** Draft — Sprint 5 S-33
> **Author:** CTO
> **Date:** 2026-03-24

---

## Problem

Production Fitsy needs observable signals to detect problems before users notice:
1. **API health** — is the backend responding?
2. **Error rates** — are requests failing unexpectedly?
3. **API costs** — are Anthropic + Google Places costs within expected ranges?
4. **Vercel analytics** — basic traffic and performance telemetry

With no monitoring, production incidents are invisible until a user reports them.

---

## Solution

MVP monitoring stack using Vercel-native tooling (free tier, no additional services):

| Signal | Tool | How |
|--------|------|-----|
| Health | `/api/health` endpoint | Vercel uptime monitoring can ping this |
| Error rates | Vercel function logs | `console.error` captured automatically |
| Error alerts | Vercel Alerts | Email on function error spike |
| Analytics | Vercel Analytics | `@vercel/analytics` + Speed Insights |
| API costs | Preload script cost log | Structured JSON summary at end of run |

---

## Diagrams

```mermaid
graph TD
    subgraph "Runtime Monitoring (Vercel)"
        Client[Mobile App] --> API[API Routes]
        API --> Health[/api/health]
        API --> Logs[Vercel Function Logs]
        Logs --> Alerts[Vercel Email Alerts]
        Analytics[Vercel Analytics] --> Dashboard[Analytics Dashboard]
    end

    subgraph "Offline Cost Tracking (Preload Script)"
        Preload[scripts/preload.ts] --> CostLog[Cost summary JSON]
        CostLog --> Manual[Manual review post-run]
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

Returns `503` if DB is unreachable. DB check: count `Restaurant` rows (fast, exercises the connection).

### 2. Vercel Analytics

Add `@vercel/analytics` and `@vercel/speed-insights` to the Next.js API project. For an API-only project, Speed Insights attaches to the root layout and tracks Web Vitals. Analytics tracks page views on any marketing/error pages.

Enable in Vercel Dashboard → Project → Analytics → Enable.

### 3. API cost tracking in preload script

The preload pipeline calls Anthropic (Haiku) and Google Places. It logs a cost summary at the end of each run. The summary is printed to stdout and can be captured by CI or manual operators.

Format:
```
[preload:costs] {
  "restaurants_discovered": 180,
  "restaurants_scraped": 153,
  "anthropic_calls": 153,
  "anthropic_tokens_in": 210000,
  "anthropic_tokens_out": 48000,
  "anthropic_cost_usd": 0.042,
  "google_places_calls": 4,
  "google_places_cost_usd": 0.032,
  "firecrawl_pages": 183,
  "total_cost_usd": 0.074
}
```

Stored nowhere at MVP — operators review stdout after each preload run. Sprint 6 can add DB persistence if needed.

### 4. Vercel error alerts

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

### Preload script additions

- Track token usage per Claude call, accumulate totals
- Track Google Places API call count
- Print `[preload:costs]` JSON at end of run

---

## Constraints

- Health check DB query must complete in <500ms — use a simple count, not a complex query
- No external monitoring services (DataDog, Sentry, etc.) at MVP — Vercel-native only
- Cost tracking is manual/stdout at MVP — no dashboards or DB persistence
- Analytics requires `@vercel/analytics` ≥2.0 for Next.js App Router compatibility

## Out of Scope

- Automated cost budget alerts (post-MVP — needs DB cost persistence first)
- Distributed tracing / OpenTelemetry
- Custom metrics dashboards
- Slack/PagerDuty alerting (Vercel email is sufficient for MVP)
