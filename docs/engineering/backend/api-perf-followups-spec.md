---
name: API Perf Follow-ups Spec
description: Apply the search-perf win pattern to remaining endpoints; add a committed profile script as the regression gate
type: spec
---

# API Perf Follow-ups

**Status:** SPEC
**Priority:** MEDIUM — none of these are user-blocking like search was, but they're cheap wins that finish the denormalization migration that's already half-shipped
**Author:** Claude
**Date:** 2026-04-26
**Triggered by:** Cross-endpoint audit run after the 60× search perf win (`docs/engineering/backend/perf-and-security-handoff-2026-04-25.md`)

---

## Problem

The 2026-04-25 perf push denormalized macros onto `MenuItem` and rewrote `findNearbyRestaurants` with `LATERAL` (60× speedup, 7,400 ms → 123 ms). But the same `MacroEstimate` join lives in **three other read paths** that were never updated. Plus a few smaller anti-patterns surfaced in the audit.

This spec is the punch list to finish the migration and squeeze a few extra wins.

---

## Findings (from cross-endpoint audit, 2026-04-26)

### Tier 1 — Stale `MacroEstimate` joins (finish the denormalization)

The win pattern: read `calories / proteinG / carbsG / fatG` directly from `MenuItem`. Drop the `macroEstimates` include unless the UI actually renders confidence/source.

| # | File:line | Issue |
|---|---|---|
| 1.1 | `apps/api/lib/restaurantService.ts:280-294` (menu detail) | Per-item `macroEstimates` include → N+1. A 50-item menu issues 51 queries. |
| 1.2 | `apps/api/app/restaurants/[slug]/page.tsx:58-62` (SEO detail) | Same `include` on the public web page. |
| 1.3 | `apps/api/app/api/saved-items/route.ts:109-112` (GET + POST) | Same join; only `[0]` is read. |

### Tier 2 — Other anti-patterns

| # | File:line | Issue | Fix |
|---|---|---|---|
| 2.1 | `apps/api/lib/restaurantService.ts:281` | Menu items returned with no `LIMIT`. A 500-item menu = 500 rows. | `take: 100` + `hasMore` flag in response contract. |
| 2.2 | `apps/api/app/api/user/profile/route.ts:200-272` | `PATCH` runs `User.update` then `MacroTarget.upsert` sequentially. Independent. | Wrap in `Promise.all`. |
| 2.3 | `apps/api/app/api/auth/{apple,google}/route.ts` | OAuth chain: `findUnique(id)` → `findUnique(email)` → `update` → `upsert`. | Collapse to one atomic `upsert` keyed on email. |
| 2.4 | `apps/api/app/api/saved-items/route.ts:177` | Read-before-write only used to pick HTTP 200 vs 201. | Drop the read; rely on upsert. |
| 2.5 | `apps/api/app/api/saved-items/[id]/route.ts:18-34` | Read-then-delete for ownership check. | `deleteMany({ where: { id, userId } })`; check affected count. |
| 2.6 | `apps/api/app/api/restaurants/preview/route.ts:90` | No `Cache-Control` on stable teaser data. | `public, max-age=3600, stale-while-revalidate=86400`. |
| 2.7 | `apps/api/app/restaurants/[slug]/page.tsx:164` + `page.tsx:114` | Raw `<img>` tags — no `next/image`, no lazy loading. | Migrate to `next/image` with `priority={false}` for off-fold. |

### Out of scope

- Rate-limiter memory leak (`rateLimit.ts:32`) — already tracked in the parked Upstash migration; revisit there.
- Sitemap, index page, `requireAuth`, auth indexes — audit confirmed clean.

---

## Expected impact

Hand-estimated, validated by the profile script before merge.

| Endpoint | Before | After (target) | Mechanism |
|---|---|---|---|
| `GET /api/restaurants/[id]/menu` (50-item menu) | ~51 queries | 1 query | Drop `macroEstimates` include |
| `GET /restaurants/[slug]` (SEO, 50-item menu) | ~51 queries | 1 query | Same |
| `GET /api/saved-items` (20 items) | 21 queries | 1 query | Same |
| `PATCH /api/user/profile` | 2 sequential awaits | 1 round-trip | `Promise.all` |
| `POST /api/auth/google` (returning user) | 3-4 awaits | 1-2 | Atomic upsert |

Headline targets: cut menu-detail wall time by ≥5× and saved-items by ≥3× on cold cache.

---

## Validation: committed profile script

The 2026-04-25 perf work used local `scripts/profile-queries.mjs` / `profile-lateral.mjs` that were never committed. We lost the ability to re-measure or regression-test.

**Fix this time:** ship `scripts/profile-api-perf.mjs` as part of this work. Properties:

1. **Hits each target endpoint in-process** (imports the handler or runs it via `next-test-api-route-handler`) so we measure the actual code path, not network.
2. **Runs each scenario twice** — first call cold (Prisma cache primed but PG cache cold via `DISCARD ALL`), second warm. Reports both.
3. **Counts queries** via `prisma.$on('query', ...)` — the most reliable proxy for the N+1 bug class. A regression here is unambiguous.
4. **Prints a markdown table** with `endpoint | scenario | queries | cold ms | warm ms`, suitable for pasting into the PR description.
5. **Exits non-zero** if query count for a scenario exceeds a hardcoded ceiling (encoded in the script). This is the regression gate.

Example invocation:

```bash
DATABASE_URL=$STAGING_URL node scripts/profile-api-perf.mjs

# endpoint                              | scenario        | queries | cold  | warm
# /api/restaurants/[id]/menu            | 50-item menu    | 1       | 38ms  | 12ms
# /api/saved-items                      | 20 saved items  | 1       | 41ms  | 14ms
# /api/user/profile (PATCH)             | macros + name   | 2       | 52ms  | —
```

Prefer this over an integration test with a p95 threshold — those are flaky on CI runners and hide query-count regressions behind wall-time noise. A query-count ceiling is deterministic.

**Optional follow-up (not blocking this ticket):** wire the script into CI as a nightly job that pages Slack on regression. Same pattern as `audit-macro-drift`. File a separate ticket if we want it.

---

## Sequencing

1. **PR 1 — Tier 1 (denormalization cleanup)**: rip `macroEstimates` include out of menu detail, saved-items, and `[slug]/page.tsx`. Add the profile script. Ship together so the script proves the fix.
2. **PR 2 — Tier 2 cleanups**: pagination, `Promise.all`, atomic upserts, cache headers, `next/image`. Re-run the profile script to confirm no regression on Tier 1 numbers.

Each PR is one domain (#backend), one reviewer, per CLAUDE.md single-domain rule.

---

## Open questions

- **Confidence in UI?** Need to grep mobile + web to confirm whether menu detail / saved items / SEO page actually render `confidence` or `source` from `MacroEstimate`. If yes, keep a `LEFT JOIN` in raw SQL (selecting only those two columns), don't restore the full Prisma include. If no, drop entirely.
- **Tier 2.3 (OAuth atomic upsert)**: requires verifying the Supabase `id` ↔ Prisma `User.id` relationship — current code may have non-obvious reasons for the chain. Check git blame before refactoring.
