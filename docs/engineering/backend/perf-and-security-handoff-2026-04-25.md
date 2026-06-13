# Perf + Security Handoff — 2026-04-25

**Status:** Perf shipped, security parked
**Author:** Claude (with Dawit)
**Date:** 2026-04-25

Out-of-sprint work triggered by user-reported slowness in the mobile search and SEO web pages. Diagnosed, fixed the search hot path top-to-bottom, then scoped (but did not ship) a follow-on security/rate-limit pass. This doc is the handoff so the security work can be picked up cleanly in a future sprint.

---

## What shipped (merged to main)

7 commits on `main`, branch `4e92719..b28cdd0`:

```
b28cdd0 perf(api): read macros from MenuItem, drop per-item MacroEstimate join
f13fd02 feat(scripts): backfill MenuItem macros from MacroEstimate
32f3752 feat(api): daily drift audit cron with Slack alerts
59c6a84 feat(pipeline): dual-write macros to MenuItem and MacroEstimate
6c9be7a feat(db): denormalize macros onto MenuItem (nullable, no backfill yet)
ed24db0 perf(api): rewrite findNearbyRestaurants with LATERAL + SQL LIMIT
5ebea94 chore: remove rescrape-thin and reestimate-low scripts
```

### Measured impact (3-mile Silver Lake search, LIMIT 20, EXPLAIN ANALYZE on staging)

| State | Cold cache | Plan |
|---|---|---|
| Before (DISTINCT ON) | **7,400 ms** | walks `Restaurant_pkey`, joins to 54,868 rows, `DISTINCT ON` collapses to 600 |
| After Step 1 (LATERAL) | **308 ms** | uses `Restaurant_lat_lng_idx`; per-restaurant LATERAL with top-1 |
| After Step 6 (LATERAL + MenuItem-only) | **123 ms** | macros read from denormalized columns; MacroEstimate joined once via `Memoize` |

**Cumulative speedup: 60×.**

### Architecture changes

- **`MenuItem` now carries denormalized macros.** Four new nullable columns (`calories`, `proteinG`, `carbsG`, `fatG`) backfilled from `MacroEstimate`. Read path queries these directly. `MacroEstimate` retains role as estimation audit log (confidence, source, reasoning, etc.) — not a duplicate of macros, just metadata.
- **`scripts/pipeline-utils.ts`** dual-writes both tables in the same transaction. Idempotency preserved (DELETE-then-INSERT pattern unchanged, just more columns in the `UNNEST`).
- **Daily drift cron** at `GET /api/internal/audit-macro-drift` — Vercel cron @ `0 14 * * *`, gated by `CRON_SECRET`. Posts to Slack `C0ASM3865AA` via `notifySlack` if `MenuItem.*` and `MacroEstimate.*` ever disagree.
- **`notifySlack` extracted** to `packages/shared/src/utils/notifySlack.ts`. Both `scripts/preload-ue-first.ts` and the new audit route use it.
- **Two scripts deleted** as cleanup: `rescrape-thin.ts` and `reestimate-low.ts`. Both were non-transactional macro writers and would have become hazardous after denormalization. Re-introducing either should go through the bulk persist path (`persistItemsInTx` / `persistHexBulkInTx`) to keep both tables in sync.

### What didn't change

- Geo filter still uses `Restaurant_lat_lng_idx` (btree on `(lat, lng)` + bounding-box `BETWEEN`). Plan now uses it; bbox step measured at ~3 ms.
- No PostGIS, no H3 hex query path. The `homeHex` column is populated by the preload pipeline but unused at read time. Worth reconsidering at 10× restaurant count — see Backlog.
- Web `/restaurants` SEO pages untouched. Separate problem (no LIMIT, no `next/image`, no pagination). See Backlog.

### Where I drew the line

Stopped after Step 6 because:
- Mobile cold-cache search is now 123 ms — within target.
- Geo step is 3 ms; further work (PostGIS, H3) is premature until table grows.
- Web SEO perf is a different stack of issues and a separate ticket.

---

## What's parked (this is the handoff)

A scope was drafted for a security + rate-limit pass. Audit findings + a 5-step plan are below. **No code changes shipped for this section** — it lives entirely in this doc and the backlog entries it references.

### Audit findings (from the parked discussion)

**1. DB size: 614 MB on Supabase free tier (500 MB cap).**
- 23% over the limit. We were already close; the denormalization added ~50 MB.
- Free tier auto-pauses at 100% — at risk of throttling/pausing. Confirm via Supabase dashboard → Project Settings → Usage.
- Recommended: upgrade to Pro ($25/mo, 8 GB).

**2. Rate-limit logic is a deterrent only.**
- `apps/api/lib/rateLimit.ts:31` — in-process sliding window, per-IP, in a JS `Map`.
- Window: 60 s, max: 10 requests.
- **Applied only to auth endpoints** (apple, google, login, register).
- Limitations baked into the source comment: "*per-instance, resets on serverless cold starts, no cross-instance sharing… replace with Upstash Redis for production hardening (SEC-02b).*"
- **Major gap: no rate limit on any data endpoint.** A valid JWT can scrape `/api/restaurants`, `/api/restaurants/[id]/menu`, `/api/saved-items*`, etc. as fast as the network allows.

**3. RLS state: enabled, no policies.**
- All 9 public tables have `relrowsecurity = true` (Supabase default).
- 0 policies exist anywhere in the `public` schema.
- API uses `service_role`, which bypasses RLS, so RLS is currently invisible to our API path.
- **The Supabase REST API (`<project>.supabase.co/rest/v1/<table>`) is fully exposed.** I tested with the anon key against every public table — all returned HTTP 200 with `[]`.
- The only thing keeping data hidden via the direct path is the default-deny behavior (RLS on, no matching policy → 0 rows). One careless permissive policy would break that.
- The anon key is in the mobile app bundle by design — anyone can extract it from the .ipa/.apk and curl Supabase directly.

**4. requireAuth audit (every API route).**

| Route | Method | requireAuth | Rate limit | Notes |
|---|---|---|---|---|
| `/api/health` | GET | ❌ | ❌ | Intentional — Vercel cron |
| `/api/restaurants` | GET | ✅ | ❌ | **Search — no rate limit** |
| `/api/restaurants/preview` | GET | ❌ | ❌ | **Intentional public** — onboarding teaser |
| `/api/restaurants/stats` | GET | ❌ | ❌ | Public — confirm purpose |
| `/api/restaurants/[id]/menu` | GET | ✅ | ❌ | Menu detail |
| `/api/saved-items` | GET, POST | ✅ | ❌ | User-scoped |
| `/api/saved-items/[id]` | DELETE | ✅ | ❌ | User-scoped |
| `/api/subscriptions/verify` | POST | ✅ | ❌ | User-scoped |
| `/api/user/profile` | GET, PATCH | ✅ | ❌ | User-scoped |
| `/api/auth/{apple,google,login,register}` | POST | n/a | ✅ | Existing 10/60s/IP |
| `/api/internal/audit-macro-drift` | GET | CRON_SECRET | ❌ | Cron only |

Web SEO pages (`apps/api/app/restaurants/page.tsx`, `[slug]`, `sitemap.ts`) are public by design and bypass `requireAuth` entirely (render via Prisma + service role).

### Mini-plan (Upstash + RLS) — parked, ready to start

| # | Step | Effort | Depends on |
|---|---|---|---|
| 1 | Audit `/api/restaurants/stats` — confirm intent, add basic gating if needed | 15 min | — |
| 2 | Replace in-process rate limiter with Upstash Redis | ~2 hr | Upstash account provisioned |
| 3 | Extend rate limits to data endpoints (per-user/per-IP) | ~2 hr | Step 2 |
| 4 | Ship RLS policies (Option A — Restaurant/MenuItem/MacroEstimate world-readable; user tables self-only) + structural test | ~1 day | — |
| 5 | Update `.env.example` and CLAUDE.md with new env vars | 15 min | — |

Total: ~1.5 days end-to-end.

### Drafted artifacts (not committed)

- **RLS migration** — `prisma/migrations/20260425000001_rls_policies/migration.sql`. Ready to apply but not added to git. If the future agent picks this up, the file is on local disk; otherwise it can be regenerated from the table in this doc. Includes policies for Restaurant/MenuItem/MacroEstimate (anon+authenticated SELECT) and User/MacroTarget/SavedItem/Subscription (self-only).

### Decisions still open

- **Should `/api/restaurants/stats` be public?** Worth a 5-min look; if it returns aggregate counts only, fine. If it leaks per-row data, gate it.
- **Per-user JWT migration (RLS becomes load-bearing).** Big change. Out of scope for the parked plan above — option A only writes policies, doesn't make them enforce. Decide separately when there's a concrete reason.
- **Cloudflare in front of API.** Catches obvious bots before our origin. Out of scope here, separate ticket.

### What needs provisioning before implementation starts

- **Upstash Redis instance** + URL/token in Vercel env (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`). Free tier covers our volume.
- **`CRON_SECRET` in Vercel prod** — already needed by the audit-macro-drift route shipped in this batch. Vercel auto-generates if missing; confirm it's there.
- **Slack bot in `C0ASM3865AA`** — already confirmed by Dawit.
- **Supabase upgrade decision** — separate from this plan but adjacent.

---

## Open questions for next session

1. Supabase upgrade — when?
2. Rate limit for data endpoints — per-user or per-IP first?
3. RLS — ship as documentation-only (Option A) or wait until per-user JWT is on the roadmap?
4. Web SEO `/restaurants` page perf — when do we tackle it? Same SEO push that triggered this work.

---

## References

- Pre-existing perf spec (some of which this superseded): `docs/engineering/archive/search-performance-spec.md`
- Sprint 10 security audit (rate-limit context): `docs/engineering/backend/security-audit-sprint10.md`
- Idempotent preload spec (referenced by the deleted scripts): `docs/engineering/backend/idempotent-preload-spec.md`
- Profiling artifacts: `scripts/profile-queries.mjs`, `scripts/profile-lateral.mjs`, `scripts/profile-lateral-v2.mjs` (untracked, kept locally for re-running EXPLAIN ANALYZE)
