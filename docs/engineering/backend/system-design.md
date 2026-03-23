# System Design — Spec Outline

> **Status**: DRAFT — awaiting human review before full write-up.
> **Author**: CTO
> **Date**: 2026-03-22

---

## 1. System Overview

- High-level description of Fitsy: macro-aware restaurant discovery
- Architecture style: React Native (Expo) mobile client + Next.js API backend (monorepo), Prisma ORM, PostgreSQL
- Key data flow summary: User query → restaurant discovery → menu retrieval → LLM macro estimation → ranked results
- Architecture diagram:

```mermaid
graph TD
    Client["Mobile App<br/>(React Native/Expo)"]

    subgraph "Next.js API Server"
        API["API Routes<br/>(orchestration layer)"]
    end

    subgraph "Service Layer (apps/api/services/)"
        RS["RestaurantService"]
        SS["ScrapingService"]
        MS["MacroEstimationService"]
        CS["ClaudeService"]
    end

    subgraph "External APIs"
        GP["Google Places API"]
        FC["Firecrawl (scrape + markdown)"]
        CL["Claude API (Haiku)"]
    end

    subgraph "Data Layer"
        Prisma["Prisma ORM"]
        PG["PostgreSQL"]
    end

    Client --> API
    API -- "1. discover restaurants" --> RS
    API -- "2. scrape menus" --> SS
    API -- "3. estimate macros" --> MS

    RS --> GP
    SS --> FC
    MS --> CS
    CS --> CL

    MS -- "cache read/write" --> Prisma
    RS --> Prisma
    Prisma --> PG
```
- **Orchestration pattern**: API routes coordinate between services. Services never call each other — each receives data as input from the route. Independently testable.
- **Three external dependencies**: Google Places (discovery), Firecrawl (scraping + markdown), Claude Haiku (macro estimation)
- Deployment topology (to be determined)

---

## 2. Data Pipeline

### 2.1 Pipeline Overview (MVP)
Three-stage pipeline: discover restaurants → scrape menus → estimate macros.

- **Discovery**: Google Places Nearby Search returns restaurants with `websiteUri` included (no Place Details call needed)
- **Menu scraping**: Firecrawl fetches restaurant websites and returns clean Markdown. Handles JS-rendered sites, anti-bot, proxies.
- **Macro estimation**: Claude Haiku estimates macros for all menu items in a single call per restaurant. Returns structured JSON with macros per item.
- **Two-phase estimation**: Batch preload returns macros only (cheap). Ingredient breakdown loaded on-demand when user taps a meal (separate Haiku call).
- **Model**: Claude Haiku 4.5 — tested at ~$0.0005/restaurant, ~1.7s latency, accurate within ±20% for common items.
- All results cached in PostgreSQL. Once estimated, cost drops to $0.

### 2.2 Restaurant Data Retrieval

```mermaid
flowchart TD
    Search["User searches by location"]
    Search --> Cache{"Restaurants cached<br/>for this area?"}

    Cache -- "Yes" --> Serve["Serve from cache<br/>(&lt;1s)"]
    Cache -- "No" --> GP["Google Places Nearby Search<br/>(returns name, address, websiteUri, photos)"]

    GP --> HasWebsite{"Has websiteUri?"}
    HasWebsite -- "Yes" --> Scrape["Firecrawl: fetch + convert<br/>to clean Markdown"]
    HasWebsite -- "No" --> Skip["Exclude from results"]

    Scrape --> Parse["Extract menu items from Markdown<br/>(name, description, price)"]
    Parse --> Estimate["Claude Haiku: estimate macros<br/>for all items (batch, macros-only)"]

    Estimate --> Store["Cache restaurants +<br/>menu items + macros"]
    Store --> Serve
    Serve --> Rank["Rank by user's macro targets"]
    Rank --> Results["Return matched restaurants"]
```

### 2.3 Two-Phase Macro Estimation

**Phase 1 — Batch macros (preload or first search):**
- Input: all menu items for a restaurant (names + descriptions)
- Claude Haiku returns compact JSON: `[{n, cal, p, c, f}]`
- ~240 input tokens, ~320 output tokens per restaurant
- Cost: ~$0.0005/restaurant
- Used for ranking and display in restaurant list

**Phase 2 — Ingredient breakdown (on-demand):**
- Triggered when user taps into a specific meal
- Separate Haiku call for that one item with full ingredient breakdown
- Cost: ~$0.001/call
- Most users view 2-3 meals per session → pay for ~5% of items

### 2.4 Scraping Design (High-Level)

_Full scraping spec to be written during implementation sprint._

**Constraints:**
- MVP scope: **Los Angeles only** (~25k restaurants)
- Preload budget: **$72** for all of LA (Google Places $40 + Firecrawl $21 + Haiku $11)
- Respect robots.txt on all sites
- Rate limit: max 2 requests/second per domain
- No scraping behind logins, paywalls, or CAPTCHAs
- Store menu data only (name, description, price) — no personal data

**Scraping pipeline:**
1. Google Places Nearby Search → restaurant list with `websiteUri`
2. Firecrawl API → fetch page, handle JS rendering, return clean Markdown
3. Claude Haiku → extract menu items from Markdown (or use schema.org `Menu` structured data when available — some sites embed this, e.g., Los Tacos No.1)

**HTML preprocessing:** Firecrawl returns clean Markdown, which reduces token consumption by 20-30% vs raw HTML and removes nav/ads/boilerplate. This is the industry standard for LLM ingestion.

**Exit criteria before launch:**
- Menu extraction rate: >60% of Google Places restaurants have parseable menus
- Macro accuracy: spot-check 50 chain items against published nutrition, within ±20% on calories
- Latency: cached results <1s, uncached restaurant <5s

**Progressive loading (uncached areas):**
1. User searches → Google Places returns restaurants (1s)
2. Show restaurant list immediately (name, cuisine, distance — no macros)
3. Scrape + estimate in background per restaurant (~3-4s each, parallelized)
4. As macros arrive, update list with match scores — restaurants reorder
5. Everything cached for next search in same area

### 2.5 Cost Model

**LA preload (one-time):**

| Component | Cost |
|---|---|
| Google Places Nearby Search (1,250 searches) | $40 |
| Firecrawl (25k pages) | $21 |
| Claude Haiku (25k restaurants, macros-only) | $11 |
| **Total** | **~$72** |

**USA scale (one-time, ~750k restaurants):**

| Component | Cost |
|---|---|
| Google Places Nearby Search | $1,200 |
| Firecrawl (750k pages) | $623 |
| Claude Haiku (750k restaurants) | $340 |
| **Total** | **~$2,163** |

**Ongoing costs at MVP:**
- Serving from cache: ~$0
- On-demand ingredient breakdown: <$0.001/call (negligible)
- Cache refresh: none at MVP (follow-up, low priority — menus rarely change)

### 2.6 Post-MVP Upgrades

In priority order:

1. **USDA cross-validation**: Run ingredient breakdown through USDA FoodData Central in background. If USDA sum diverges >15% from LLM's stated macros, flag lower confidence.
2. **Verified data layer**: Search for restaurant-published nutrition data. When found, use instead of LLM — highest confidence.
3. **Prompt calibration loop**: Log LLM estimates vs verified data for chains. Use divergence patterns to improve prompts.
4. **User corrections**: Let users flag "this doesn't look right" — feeds into prompt tuning.
5. **Confidence scoring model**: Score based on: known chain? description detail? photo available? common ingredients?
6. **Extended retrieval**: Web search fallback for restaurants without websites. Google Places photo menu extraction via Claude vision.
7. **Cache refresh**: Periodic re-estimation on a schedule. Low priority — menus rarely change.
8. **Fine-tuned model**: Once we have enough estimates + user corrections as training data, fine-tune a small model for near-zero inference cost.

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
- Macro target matching: calorie range, protein min, carb max, fat max
- Cuisine filter, chain vs. independent filter
- Sort options: distance, macro match closeness, confidence tier

---

## 4. External Service Integration

### 4.1 Integration Principles
- All external calls go through service wrappers in `apps/api/services/`
- Each wrapper handles: auth, request formatting, response normalization, error mapping
- No raw external API types leak into business logic

### 4.2 Google Places API (New)
- Purpose: restaurant discovery by location, metadata, `websiteUri`
- Endpoints used: Nearby Search (returns websiteUri — no Place Details needed)
- Cost: $0.032 per Nearby Search call (returns up to 20 results)
- Response mapping to internal Restaurant model

### 4.3 Firecrawl API
- Purpose: scrape restaurant websites, handle JS rendering, return clean Markdown
- Handles: JavaScript-rendered sites, anti-bot, proxies, CAPTCHA
- Returns: clean Markdown (20-30% fewer tokens than raw HTML)
- Cost: $0.00083/page (Standard plan, 100k credits/$83)
- Also detects schema.org structured data (some sites embed `Menu` schemas)

### 4.4 Claude API (Haiku 4.5)
- Purpose: macro estimation — the core of the pipeline
- **Phase 1 (batch)**: Macros-only per restaurant, compact JSON output
- **Phase 2 (on-demand)**: Full ingredient breakdown for a single item
- Cost: ~$0.0005/restaurant (batch), ~$0.001/item (breakdown)
- Latency: ~1.7s per call
- Prompt versioning strategy (prompts are a core asset — version and track changes)

### 4.5 Yelp Fusion API (Optional, post-MVP)
- Purpose: supplementary restaurant data, reviews, photos
- When to use: fallback if Google Places data is insufficient

---

## 5. Data Model / Database Schema

### 5.1 Core Entities
- **User**: id, email, name, auth fields, created/updated timestamps
- **MacroTarget**: userId (FK), calories, proteinG, carbsG, fatG, goal type
- **Restaurant**: id, externalPlaceId, name, address, lat, lng, cuisine tags, chain flag, source, created/updated
- **MenuItem**: id, restaurantId (FK), name, description, photoUrl, category, price, created/updated
- **MacroEstimate** (cache): id, menuItemId (FK), calories, proteinG, carbsG, fatG, confidence (medium/low), hadPhoto (bool), ingredientBreakdown (JSON), reasoning (text), estimatedAt, expiresAt
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
- On first request for a menu item: run pipeline, persist MacroEstimate row
- Subsequent requests: serve from cache if not stale
- Staleness threshold: 14 days (LLM estimates may improve with model/prompt updates)
- Re-estimation: **on-demand only** — when a stale record is accessed, re-estimate inline. No background jobs at MVP scale.

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

- Pipeline latency budget: target < 2s for cached, < 8s for uncached estimation
- Parallel external API calls where independent (e.g., restaurant fetch + cache check)
- Database query optimization: lean selects, avoid N+1 on menu item lists
- Batch LLM calls: estimate multiple menu items per request where possible
- Connection pooling for database and HTTP clients
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
- **Scraping approach**: Firecrawl API for all page fetching. Handles JS rendering, anti-bot, returns clean Markdown. No self-hosted headless browsers at MVP.
- **MVP geography**: Los Angeles only. Total preload cost: ~$72.
- **Place Details not needed**: `websiteUri` is available directly from Nearby Search, saving $0.017/restaurant.
- **Two-phase estimation**: Macros-only for batch (cheap), ingredient breakdown on-demand (pay for ~5% of items).

## Open Questions

- [ ] Neon vs. Supabase — both work, pick before first migration
- [ ] Prompt structure: how many menu items can we batch per call while maintaining accuracy?
- [ ] Menu extraction rate in practice — need to test against 100+ LA restaurants to validate >60% target
