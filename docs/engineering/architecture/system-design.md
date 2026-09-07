# System Design

> **Status:** living · **Last verified:** 2026-06-12
> **Author**: CTO
> **Originally drafted**: 2026-03-22

---

## 1. System Overview

Fitsy is a macro-aware restaurant discovery app. Users search by location and
macronutrient targets; the app returns nearby restaurants with meals matching
their goals.

**Architecture:** React Native (Expo) mobile client + Next.js API backend
(monorepo), Prisma ORM, PostgreSQL.

**Key insight: the API backend does not scrape or estimate macros at runtime.**
All restaurant and macro data is preloaded offline by a batch script. The API
backend is a read-only query layer over a pre-populated database.

### 1.1 Two Separate Systems

```mermaid
graph TD
    subgraph offline["Offline: Preload Pipeline — scripts/preload-ue-first.ts"]
        UE["Uber Eats getFeedV1\n(unauthenticated, uev2.loc cookie)\nrestaurant discovery"]
        FS["FatSecret / FoodFacts\nchain macro lookup"]
        BS["Brave Search + Uber Eats JSON-LD\nindependent restaurant menus"]
        CL["Claude Haiku\nmacro estimation\n(indie menus)"]
        AX["Axiom telemetry\nfitsy-pipeline dataset"]
        PG_off["PostgreSQL\nRestaurant + MenuItem\n(macros denormalized)"]

        UE --> FS
        UE --> BS
        BS --> CL
        FS --> PG_off
        CL --> PG_off
        AX -.->|telemetry| PG_off
    end

    subgraph online["Online: API Backend — apps/api/"]
        Client["Mobile App\nReact Native / Expo"]
        API["API Routes\n(requireAuth)"]
        RS["restaurantService.ts\nLATERAL + denormalized macro columns"]
        Prisma["Prisma ORM"]
        PG_on["PostgreSQL\npreloaded data"]
        Client --> API
        API --> RS
        RS --> Prisma
        Prisma --> PG_on
    end
```

### 1.2 Preload Pipeline (Offline — UE-first)

Primary script: `scripts/preload-ue-first.ts`. Runs as a batch script (not a production service) with `--phase` flags for H3-hex-level checkpointing and midnight-safe auto-resume.

| Component | Purpose | Used at runtime? |
|---|---|---|
| Uber Eats `getFeedV1` | Restaurant discovery (unauthenticated, uev2.loc cookie; lat/lng authoritative) | No — preload only |
| FatSecret / FoodFacts (FFN) | Chain restaurant macro lookup (accurate, pre-verified) | No — preload only |
| Brave Search + Uber Eats JSON-LD | Independent restaurant menus | No — preload only |
| Claude Haiku | Macro estimation from indie menu text | No — preload only |
| Axiom (`fitsy-pipeline` dataset) | Pipeline telemetry and run logging | No — preload only |
| Google Places API | Optional tier-3 photo fallback only | No — removed from discovery |

**Google Places was removed from restaurant discovery.** It is only retained as an optional photo-quality fallback (tier 3). The pipeline moved from Google Places → Overture Maps → UE-first. Current state is UE-first.

**Pipeline flow:**

1. `getFeedV1` probe (Uber Eats) — hexes tiled by H3; returns restaurants with lat/lng per store
2. Chain identification — match against FatSecret/FoodFacts chain database for verified macros
3. Independent restaurants — Brave Search finds menu URL; Uber Eats JSON-LD extracted from the page
4. Claude Haiku — estimates macros from menu text for independents without structured data
5. Dual-write to PostgreSQL — macros written to both `MenuItem` (denormalized) and `MacroEstimate` (audit log) in the same transaction

Telemetry for each run ships to Axiom dataset `fitsy-pipeline`. Slack alerts go to `C0ASM3865AA`.

### 1.3 API Backend (Online)

The Next.js backend is a **read-only query layer**. No external API calls at request time. No scraping, no LLM calls, no macro estimation.

| Component | Purpose |
|---|---|
| `restaurantService.ts` | LATERAL join query over denormalized MenuItem macro columns |
| `requireAuth` | JWT middleware (Supabase JWKS, ES256) |
| Prisma ORM | Database access |
| PostgreSQL | Preloaded restaurant + menu data |

**Macro read path:** Macros are stored in four denormalized columns on `MenuItem` (`calories`, `proteinG`, `carbsG`, `fatG`) and read directly — no `MacroEstimate` join in the hot path. This achieved a **60× speedup** (7,400 ms → 123 ms cold cache) post-2026-04-25. See `docs/engineering/backend/perf-and-security-handoff-2026-04-25.md`.

The `MacroEstimate` table is kept as an audit log (confidence, source, reasoning) and is only fetched when the detail view needs that metadata.

See `docs/engineering/architecture/api-reference.md` for the full route reference.

### 1.4 External Dependencies Summary

| Service | Used by | When |
|---|---|---|
| Uber Eats `getFeedV1` | Preload script | Offline batch — restaurant discovery |
| FatSecret / FoodFacts | Preload script | Offline batch — chain macros |
| Brave Search | Preload script | Offline batch — indie menu URLs |
| Claude Haiku | Preload script | Offline batch — macro estimation |
| Axiom | Preload script | Offline batch — telemetry |
| Google Places API | Preload script (optional) | Tier-3 photo fallback only |
| Supabase | API backend + mobile | Auth (signInWithIdToken + JWKS) |
| RevenueCat | API backend + mobile | Subscription management |
| PostHog | Mobile client | Analytics (30+ events) |

---

## 2. Data Pipeline

### 2.1 Pipeline Overview (UE-first)

The pipeline uses Uber Eats as the primary discovery source, FatSecret/FoodFacts for chain macros, and Brave Search + Uber Eats JSON-LD for independent restaurant menus. Claude Haiku fills in macro estimates where structured data is unavailable.

- **Discovery**: Uber Eats `getFeedV1` (unauthenticated, captured `uev2.loc` cookie; lat/lng per store authoritative from Uber Eats response) tiled by H3 hexes with midnight-safe auto-resume
- **Chain macros**: FatSecret/FoodFacts lookups — verified, accurate, low cost
- **Independent menus**: Brave Search finds the menu URL; Uber Eats JSON-LD extracted; Claude Haiku estimates macros from unstructured text
- **H3 checkpointing**: each hex is processed atomically; failed hexes auto-resume on restart
- **Telemetry**: all run events ship to Axiom dataset `fitsy-pipeline`; Slack alerts on error to `C0ASM3865AA`

Baseline (Stage 3 end-to-end, one hex, LA): **94 restaurants, 6,791 items, 0 Google Places calls, +24% over v6 baseline.**

### 2.2 UE-first Preload Flow

```mermaid
flowchart TD
    Start["scripts/preload-ue-first.ts\n--phase flags + H3 hex tiling"]

    Start --> UE["Uber Eats getFeedV1\nrestaurant discovery\n(uev2.loc cookie, lat/lng per store)"]

    UE --> IsChain{"Chain\nrestaurant?"}

    IsChain -- "Yes" --> FFN["FatSecret / FoodFacts\nverified chain macro lookup"]
    IsChain -- "No" --> Brave["Brave Search\nfind menu URL"]

    Brave --> UEJLD["Uber Eats JSON-LD\nextract structured menu data"]
    UEJLD --> HasMenu{"Structured\ndata found?"}
    HasMenu -- "No" --> Haiku["Claude Haiku\nmacro estimation"]
    HasMenu -- "Yes" --> DualWrite

    FFN --> DualWrite
    Haiku --> DualWrite

    DualWrite["Dual-write in $transaction:\nMenuItem (denormalized macros)\n+ MacroEstimate (audit log)"]
    DualWrite --> PG["PostgreSQL"]
    DualWrite --> Axiom["Axiom telemetry\nfitsy-pipeline"]
```

**User search flow (production — unchanged):**

```mermaid
flowchart TD
    Search["User searches by location + targets"]
    Search --> Auth["requireAuth\nSupabase JWKS"]
    Auth --> DB["LATERAL query\nMenuItem denormalized macros\n(123 ms cold cache)"]
    DB --> Rank["Rank by macro match score"]
    Rank --> Results["Return matched restaurants"]
```

### 2.3 Macro Storage — Denormalized on MenuItem

Macros are stored in **two places** (dual-written in a single transaction):

1. **`MenuItem` columns** (`calories`, `proteinG`, `carbsG`, `fatG`) — the read path. The API queries these directly via the LATERAL join. Fast, no join needed.
2. **`MacroEstimate` table** — the audit log. Stores `confidence`, `source`, `reasoning`, `estimatedAt`, `hadPhoto`. Queried only for the detail view, never in the ranking hot path.

This dual-write is enforced in `scripts/pipeline-utils.ts` (`persistItemsInTx` / `persistHexBulkInTx`). Both tables must always be written together — the daily drift cron at `GET /api/internal/audit-macro-drift` alerts if they diverge.

### 2.4 Pipeline Operations

The pipeline is invoked with `--phase` flags (not `npm run preload`). See `docs/engineering/pipeline/ue-first-pipeline.md` for the full phase breakdown (the superseded v3 architecture is archived at `docs/engineering/archive/data-pipeline-v3.md`).

**Constraints:**
- MVP scope: **Los Angeles only** (H3 hex grid over the LA metro)
- Respect robots.txt on all sites
- Rate limit: max 2 requests/second per domain
- No scraping behind logins, paywalls, or CAPTCHAs
- Store menu data only (name, description, price) — no personal data

**Scraping pipeline:**
1. Google Places Nearby Search → restaurant list with `websiteUri`
2. Firecrawl API → fetch + crawl pages, handle JS rendering, return clean Markdown
3. Claude Haiku → extract menu items from Markdown (or use schema.org `Menu` structured data when available — some sites embed this, e.g., Los Tacos No.1)

**Multi-page navigation (to be detailed in scraping spec):**
- Most restaurants require 2-3 page fetches (homepage → menu → subpages)
- Budget: ~2-3 pages per restaurant

**Scraping tool:**
- MVP: **Firecrawl** (managed, no infra — $83/mo for 100k credits)
- Post-MVP: swap to **Crawl4AI** (open source, self-hosted via Docker, $0 software cost) or DIY Playwright + Turndown. Saves ~$1,800 at USA scale.
- Scraping service must be behind an interface so the provider is swappable without changing business logic.

**HTML preprocessing:** Firecrawl returns clean Markdown, which reduces token consumption by 20-30% vs raw HTML and removes nav/ads/boilerplate. Industry standard for LLM ingestion.

**Exit criteria before launch:**
- Menu extraction rate: >60% of restaurants in target area have parseable menus
- Macro accuracy: spot-check 50 chain items against published nutrition, within ±20% on calories
- All results served from cache in <1s

### 2.5 Cost Model

**MVP-0 preload (few zip codes in LA, ~200-500 restaurants):**

| Component | Cost |
|---|---|
| Google Places Nearby Search | $1-2 |
| Firecrawl (~1,500 pages) | $1-2 |
| Claude Haiku | $0.25 |
| **Total** | **~$2-5** |

**Full LA preload (~25k restaurants):**

| Component | Cost |
|---|---|
| Google Places Nearby Search (1,250 searches) | $40 |
| Firecrawl (~75k pages at ~3/restaurant) | $63 |
| Claude Haiku (25k restaurants, macros-only) | $11 |
| **Total** | **~$114** |

**USA scale (~750k restaurants):**

| Component | Cost |
|---|---|
| Google Places Nearby Search | $1,200 |
| Firecrawl (~2.25M pages, or Crawl4AI at ~$50-100) | $100-1,868 |
| Claude Haiku (750k restaurants) | $340 |
| **Total** | **~$1,640-3,408** |

**Ongoing costs:** ~$0. Serving from cache only. Cache refresh and on-demand ingredient breakdown are post-MVP.

### 2.6 Scaling Strategy (Post-MVP)

**Expand preload coverage:**
- MVP-0: few zip codes in LA (~500 restaurants, ~$5)
- MVP-1: all of LA (~25k restaurants, ~$114)
- Scale: all of USA (~750k restaurants, ~$1,640-3,408 one-time)
- Preloading all of USA is feasible and avoids building a live pipeline entirely. At ~$1,640 with Crawl4AI, it's cheaper than a month of live scraping infrastructure.

**Live scraping pipeline (consider if needed):**
- Only needed if we can't preload fast enough for demand (e.g., expanding to new cities faster than preload can run)
- Adds significant complexity: real-time Firecrawl orchestration, error handling, latency management
- If built: show restaurant list immediately, macros fill in as estimation completes (~3-4s/restaurant)
- Recommendation: preload aggressively, avoid live pipeline as long as possible

### 2.7 Post-MVP Accuracy Upgrades

In priority order:

1. **On-demand ingredient breakdown**: Separate Haiku call when user taps a meal — shows reasoning behind the estimate.
2. **USDA cross-validation**: Run ingredient breakdown through USDA FoodData Central in background. Flag discrepancies >15%.
3. **Verified data layer**: Search for restaurant-published nutrition data. When found, use instead of LLM.
4. **Prompt calibration loop**: Log LLM estimates vs verified data for chains. Use divergence patterns to improve prompts.
5. **User corrections**: Let users flag "this doesn't look right" — feeds into prompt tuning.
6. **Confidence scoring model**: Score based on: known chain? description detail? photo available? common ingredients?
7. **Extended retrieval**: Web search fallback for restaurants without websites. Google Places photo menu extraction via Claude vision.
8. **Cache refresh**: Periodic re-estimation on a schedule. Low priority — menus rarely change.
9. **Fine-tuned model**: Once we have enough estimates + user corrections as training data, fine-tune a small model for near-zero inference cost.

---

## 3. API Architecture

The Next.js backend is API-only — no server-rendered pages. All endpoints serve JSON and are consumed by the React Native (Expo) mobile client.

### 3.1 Endpoint Inventory
- `GET /api/restaurants` — discover nearby restaurants (lat/lng, radius, filters)
- `GET /api/restaurants/[id]` — restaurant detail with menu items
- `GET /api/restaurants/[id]/menu` — menu items with cached macros
- `POST /api/meals/estimate` — on-demand macro estimation for a menu item
- `GET /api/user/targets` — retrieve user's macro targets
- `PUT /api/user/targets` — update macro targets
- `GET /api/user/saved` — saved restaurants / meals
- `POST /api/user/saved` — save a restaurant or meal

### 3.2 Request/Response Patterns
- Standard JSON envelope: `{ data, error, meta }`
- Pagination: cursor-based for list endpoints
- Error shape: `{ "error": "message" }` with HTTP status codes
- Macro results always include `{ confidence, hadPhoto, estimatedAt, ingredientBreakdown }`

### 3.3 Query and Filtering

**Distance filtering (hard cutoff):**
- `radius` param: user-configurable max distance (1mi, 3mi, 5mi, 10mi). Default: 3mi.
- PostGIS `ST_DWithin` query on restaurant `(lat, lng)` — only returns restaurants within the radius.
- Distance is a **filter**, not a ranking signal.

**Ranking (by macro match quality):**
- Primary sort: **macro match score** — how closely a restaurant's best menu item matches the user's macro targets.
- Match score calculation: for each menu item, compute distance from user targets across all specified macros (calories, protein, carbs, fat). Restaurant score = best item score.
- A restaurant 2mi away with a perfect macro match ranks above one 0.5mi away with a poor match.
- Tie-breaking: number of matching items (more options = better), then distance.

**Additional filters:**
- Cuisine type (multi-select)
- Chain vs. independent
- Confidence tier (optional: only show high-confidence estimates)

**Match score formula (to be refined during implementation):**
- Normalize each macro dimension by the user's target
- Weighted Euclidean distance: `sqrt(w_cal * (cal_diff/target)^2 + w_p * (p_diff/target)^2 + ...)`
- Only compute on dimensions the user specified (skip unset fields)
- Lower score = better match

---

## 4. External Service Integration

### 4.1 Integration Principles
- **Preload script**: calls external APIs directly (no wrappers needed — it's a batch script, not a service)
- **API backend**: no external API calls at runtime. All data served from DB. Auth delegates to Supabase JWKS.
- No raw external API types leak into business logic

### 4.2 Uber Eats `getFeedV1` (Preload — Discovery)
- Purpose: primary restaurant discovery; returns restaurant list with per-store lat/lng
- Method: unauthenticated probe using a captured `uev2.loc` cookie
- Geo: lat/lng from the Uber Eats response is authoritative (per-store, more accurate than centroid)
- H3 hex tiling: the pipeline tiles the target area by H3 resolution and probes each hex
- **Not used at runtime** — preload only

### 4.3 FatSecret / FoodFacts (Preload — Chain Macros)
- Purpose: verified macro data for chain restaurants
- Chain identification is done in the pipeline; matched restaurants skip the Haiku estimation step
- **Not used at runtime** — preload only

### 4.4 Brave Search + Uber Eats JSON-LD (Preload — Indie Menus)
- Purpose: find menu URLs for independent restaurants; extract structured menu data
- Brave Search finds the likely menu URL; JSON-LD extraction pulls schema.org `Menu` data from the Uber Eats page for the restaurant
- **Not used at runtime** — preload only

### 4.5 Claude API (Haiku — Preload, Indie Macro Estimation)
- Purpose: macro estimation from unstructured indie restaurant menu text
- Used for independent restaurants where FatSecret doesn't match and JSON-LD is unavailable
- Returns structured JSON with item name, calories, protein, carbs, fat, confidence tier
- **Not used at runtime** — all estimates precomputed and stored in DB

### 4.6 Google Places API (Optional — Photo Fallback Only)
- Previously used for restaurant discovery; **removed from the discovery path**
- Retained as an optional tier-3 photo quality fallback only
- The `GOOGLE_PLACES_API_KEY` env var is now optional

### 4.7 Supabase (Auth — Runtime)
- Purpose: `signInWithIdToken` for Apple and Google Sign-In; issues Supabase JWTs
- The API backend verifies JWTs via the Supabase JWKS endpoint (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
- No local JWT signing — Supabase is the trust anchor

### 4.8 Axiom (Preload — Telemetry)
- Dataset: `fitsy-pipeline`
- All pipeline run events (hex start/end, restaurant counts, errors) ship to Axiom
- Slack alerts for errors go to `C0ASM3865AA` via `SLACK_BOT_TOKEN`

---

## 5. Data Model / Database Schema

### 5.1 Core Entities
- **User**: id, email, name, auth fields, created/updated timestamps
- **MacroTarget**: userId (FK), calories, proteinG, carbsG, fatG, goal type
- **Restaurant**: id, externalPlaceId, name, address, lat, lng, cuisine tags, chain flag, source, created/updated
- **MenuItem**: id, restaurantId (FK), name, description, photoUrl, category, price, created/updated
- **MacroEstimate** (cache): id, menuItemId (FK), calories, proteinG, carbsG, fatG, confidence (high/medium/low), hadPhoto (bool), ingredientBreakdown (JSON), reasoning (text), estimatedAt, expiresAt
- **SavedItem**: userId (FK), restaurantId or menuItemId (FK), type, created

### 5.2 Entity Relationship Diagram

```mermaid
erDiagram
    User {
        string id PK
        string email UK
        string name
        datetime createdAt
        datetime updatedAt
    }

    MacroTarget {
        string id PK
        string userId FK
        int calories
        float proteinG
        float carbsG
        float fatG
        string goalType
    }

    Restaurant {
        string id PK
        string externalPlaceId UK
        string name
        string address
        float lat
        float lng
        string cuisineTags
        boolean chainFlag
        string source
        datetime createdAt
        datetime updatedAt
    }

    MenuItem {
        string id PK
        string restaurantId FK
        string name
        string description
        string photoUrl
        string category
        float price
        datetime createdAt
        datetime updatedAt
    }

    MacroEstimate {
        string id PK
        string menuItemId FK
        int calories
        float proteinG
        float carbsG
        float fatG
        string confidence
        boolean hadPhoto
        json ingredientBreakdown
        string reasoning
        datetime estimatedAt
        datetime expiresAt
    }

    SavedItem {
        string id PK
        string userId FK
        string restaurantId FK "nullable"
        string menuItemId FK "nullable"
        string type
        datetime createdAt
    }

    User ||--o| MacroTarget : "has"
    User ||--o{ SavedItem : "saves"
    Restaurant ||--o{ MenuItem : "has"
    MenuItem ||--o{ MacroEstimate : "estimated by"
    Restaurant ||--o{ SavedItem : "saved in"
    MenuItem ||--o{ SavedItem : "saved in"
```

### 5.3 Key Relationships
- User 1:1 MacroTarget
- User 1:N SavedItem
- Restaurant 1:N MenuItem
- MenuItem 1:N MacroEstimate (history; latest = active)

### 5.4 Indexes
- Restaurant: geospatial index on (lat, lng), index on externalPlaceId
- MenuItem: index on restaurantId, composite index on (restaurantId, name)
- MacroEstimate: index on menuItemId, index on expiresAt (for staleness queries)

---

## 6. Caching Strategy

### 6.1 Macro Cache Lifecycle
- **MVP-0**: All macro estimates are preloaded. No estimation at runtime. Every request is a DB read.
- **Post-MVP**: Staleness threshold of 14 days. Re-estimation on-demand when a stale record is accessed, or via periodic re-preload batch.
- No background jobs at MVP scale.

### 6.2 Cache Invalidation
- Explicit: admin or user flags an estimate as wrong
- Time-based: expiresAt field checked on read
- Source change: if restaurant menu is updated (detected via Place Details)

### 6.3 Application-Level Caching
- Start with **in-memory LRU cache** (no Redis at MVP). Monitor memory utilization and cache hit rate to know when to migrate.
- Restaurant search results: short-lived in-memory cache (~5 min TTL)
- Rate limit budgets tracked per service per time window

---

## 7. Error Handling and Resilience

### 7.1 External Service Failures
- Circuit breaker pattern per external service
- Retry policy: exponential backoff, max 3 retries for transient errors
- Timeout budgets: per-service configurable timeouts
- Graceful degradation: return restaurant without macros if estimation fails

### 7.2 Rate Limit Management
- Track remaining quota per API key per service
- Proactive throttling before hitting hard limits
- Queue and defer non-urgent requests when near limits
- Alert on sustained high usage

### 7.3 Pipeline Failure Modes
- LLM failure (timeout, error, malformed response): return "estimation unavailable", flag for retry
- LLM returns inconsistent data (ingredients don't sum to totals): accept LLM totals, flag ingredient breakdown as approximate
- Menu retrieval failure (website unreachable, no parseable menu): exclude restaurant from results

### 7.4 User-Facing Error Responses
- Consistent `{ "error": "message" }` format
- Never expose internal service details or API keys
- Actionable messages where possible ("try again", "results may be incomplete")

---

## 8. Performance Considerations

- All searches served from preloaded cache — target <1s response time
- Database query optimization: lean selects, avoid N+1 on menu item lists
- Geospatial index on restaurant (lat, lng) for fast nearby queries
- Connection pooling for database clients
- Response payload size: paginate menu items, lazy-load macro details

---

## 9. Security Considerations

- API keys stored in environment variables, never in code or the mobile app bundle
- All external service calls server-side only (no API key exposure to the mobile client)
- Secure token storage on device via `expo-secure-store` for auth tokens
- User input sanitization on search queries and filter parameters
- Rate limiting on public API routes to prevent abuse
- Authentication required for user-specific endpoints (targets, saved items)
- Macro estimates include confidence disclaimers — never present estimates as medical/dietary advice
- Audit logging for macro estimate corrections and cache invalidations
- HTTPS only; CORS configured to allow requests from the mobile client

---

## Resolved Questions

- **Database hosting**: Managed Postgres (Neon or Supabase) — free tier for MVP, PostGIS support for geospatial queries
- **Application caching**: In-memory LRU to start. Monitor utilization; migrate to Redis when needed.
- **Background jobs**: None at MVP. Cache refresh is a low-priority follow-up.
- **Photo sourcing**: Google Places only. No user uploads.
- **Pipeline approach**: Three-stage (discover → scrape → estimate). Single LLM call per restaurant for batch macros. Ingredient breakdown on-demand.
- **Estimation model**: Claude Haiku 4.5. Tested: accurate within ±20% for common items, ~1.7s latency, ~$0.0005/restaurant. Gemini Flash-Lite tested but less reliable (outlier estimates).
- **Scraping approach**: Firecrawl search + map + scrape pipeline (validated in spike, see `docs/engineering/archive/scraping-spike.md`). Firecrawl search with `scrapeOptions` is the primary discovery mechanism — finds menus on aggregator sites. Map and homepage scrape as fallbacks. No self-hosted headless browsers.
- **MVP geography**: Los Angeles only (90029 zip code for MVP-0). Preload cost: ~$0.25 for 50 restaurants.
- **Place Details not needed**: `websiteUri` is available directly from Nearby Search, saving $0.017/restaurant.
- **Two-phase estimation**: Macros-only for preload (cheap), ingredient breakdown on-demand post-MVP.
- **No runtime external API calls**: MVP-0 is preload-only. The API backend is a read-only query layer.
- **Menu extraction rate**: ~85-90% validated in spike (50 restaurants in 90029). Remaining ~10-15% are image-based menus or restaurants with no online presence.

## Open Questions

- [ ] Neon vs. Supabase — both work, pick before first migration
- [ ] Prompt structure: how many menu items can we batch per call while maintaining accuracy?
