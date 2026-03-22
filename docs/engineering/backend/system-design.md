# System Design — Spec Outline

> **Status**: DRAFT — awaiting human review before full write-up.
> **Author**: CTO
> **Date**: 2026-03-22

---

## 1. System Overview

- High-level description of Fitsy: macro-aware restaurant discovery
- Architecture style: React Native (Expo) mobile client + Next.js API backend (monorepo), Prisma ORM, PostgreSQL
- Key data flow summary: User query -> restaurant discovery -> menu retrieval -> tiered macro estimation -> ranked results
- Architecture diagram:

```mermaid
graph TD
    Client["Mobile App (React Native/Expo)"]

    subgraph "Next.js API Server"
        API["API Routes"]
    end

    subgraph "Service Layer (src/services/)"
        RS["RestaurantService"]
        MS["MacroEstimationService"]
        NS["NutritionixService"]
        CS["ClaudeService"]
    end

    subgraph "External APIs"
        GP["Google Places API"]
        NX["Nutritionix API"]
        CL["Claude API"]
        YP["Yelp Fusion API"]
    end

    subgraph "Data Layer"
        Prisma["Prisma ORM"]
        PG["PostgreSQL"]
        MC["MacroEstimate Cache"]
    end

    Client --> API
    API --> RS
    API --> MS

    RS --> GP
    RS --> YP
    MS --> NS
    MS --> CS

    NS --> NX
    CS --> CL

    MS -- "cache read (check existing)" --> Prisma
    MS -- "cache write (persist estimate)" --> Prisma
    RS --> Prisma
    Prisma --> PG
    Prisma --> MC

    MC -. "stale? re-estimate" .-> MS
```
- Deployment topology (to be determined)

---

## 2. Tiered Macro Estimation Pipeline

### 2.1 Pipeline Overview
- Every menu item is resolved through the highest-confidence tier available
- Pipeline short-circuits: if Tier 1 returns data, skip Tier 2 and 3
- Each tier produces a normalized intermediate format: list of `{ ingredient, quantity, unit }`
- Final step (Nutritionix lookup) converts ingredients to macros and sums totals
- Confidence tier is stored alongside results and exposed to the user

### 2.2 Tier 1 — Verified Data
- Two-step lookup (both are high-confidence since the source is the restaurant or a verified DB):
  1. **Nutritionix Branded/Common Foods DB**: API lookup by restaurant chain + menu item name. Fast, structured, covers major chains.
  2. **Restaurant website fallback**: If Nutritionix misses, check the restaurant's own nutrition page/PDF.
     - Structured HTML tables → simple scraper, no LLM needed
     - Nutrition PDFs (common for chains) → PDF table extraction library; LLM fallback for messy layouts
     - Note: LLM here is an *extraction* tool, not an estimation source — confidence stays high
- Maintain a per-restaurant registry of known nutrition URL/PDF locations (cached)
- When matched: return macros directly (skip ingredient decomposition)
- Confidence: high
- Edge cases: menu item name mismatches, regional menu variations, PDF format changes

### 2.3 Tier 2 — Photo Estimation
- Source: menu item photos (from Google Places, restaurant sites, or user uploads)
- Claude vision model identifies visible ingredients, estimates portions
- Output: ingredient list with estimated quantities
- Confidence: medium
- Edge cases: obscured ingredients, garnishes vs. core components, portion distortion

### 2.4 Tier 3 — LLM Description Parsing
- Source: menu item name and text description only (no photo available)
- Claude text model infers likely ingredients and portions
- Output: ingredient list with estimated quantities
- Confidence: low
- Edge cases: vague descriptions ("chef's special"), culturally specific dishes

### 2.5 Nutritionix Lookup (Shared Final Step)
- Receives ingredient list from Tier 2 or Tier 3
- Maps each ingredient + quantity to Nutritionix common foods API
- Sums per-ingredient macros (calories, protein, carbs, fat) for menu item total
- Handles partial matches (best-effort ingredient mapping)
- Returns structured macro result with per-ingredient breakdown

### 2.6 Pipeline Data Flow Diagram

```mermaid
flowchart TD
    Start["Menu Item Received"] --> CacheCheck{"Cached estimate\nexists & fresh?"}

    CacheCheck -- "Yes" --> ReturnCached["Return cached macros"]
    CacheCheck -- "No" --> T1NX{"Tier 1:\nNutritionix\nBranded DB lookup"}

    T1NX -- "Hit" --> StoreT1A["Store estimate\n(tier: 1, confidence: high)"]
    StoreT1A --> Return1["Return macros"]

    T1NX -- "Miss" --> T1Web{"Tier 1:\nRestaurant website\nnutrition page/PDF"}

    T1Web -- "Hit" --> StoreT1B["Store estimate\n(tier: 1, confidence: high)"]
    StoreT1B --> Return2["Return macros"]

    T1Web -- "Miss" --> PhotoCheck{"Photo available?"}
    T1Web -- "Error (scrape/parse fail)" --> PhotoCheck

    PhotoCheck -- "Yes" --> T2["Tier 2: Claude Vision\nidentify ingredients\n& estimate portions"]
    PhotoCheck -- "No" --> T3["Tier 3: Claude Text\nparse name/description\n& infer ingredients"]

    T2 --> T2OK{"Vision\nsucceeded?"}
    T2OK -- "Yes" --> NXLookup2["Nutritionix Lookup:\nmap ingredients → macros\nsum totals"]
    T2OK -- "No (model error)" --> T3

    T3 --> T3OK{"LLM parse\nsucceeded?"}
    T3OK -- "Yes" --> NXLookup3["Nutritionix Lookup:\nmap ingredients → macros\nsum totals"]
    T3OK -- "No (LLM error)" --> Unavailable["Return 'estimation unavailable'\nflag for retry"]

    NXLookup2 --> NX2OK{"Lookup\nsucceeded?"}
    NX2OK -- "Full match" --> StoreT2["Store estimate\n(tier: 2, confidence: medium)"]
    NX2OK -- "Partial match" --> StoreT2Warn["Store partial estimate\n(tier: 2, confidence: medium)\nwith warning"]
    NX2OK -- "Failure" --> T3

    StoreT2 --> Return3["Return macros"]
    StoreT2Warn --> Return3

    NXLookup3 --> NX3OK{"Lookup\nsucceeded?"}
    NX3OK -- "Full match" --> StoreT3["Store estimate\n(tier: 3, confidence: low)"]
    NX3OK -- "Partial match" --> StoreT3Warn["Store partial estimate\n(tier: 3, confidence: low)\nwith warning"]
    NX3OK -- "Failure" --> Unavailable

    StoreT3 --> Return4["Return macros"]
    StoreT3Warn --> Return4
```

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
- Macro results always include `{ tier, confidence, estimatedAt, source }`

### 3.3 Query and Filtering
- Macro target matching: calorie range, protein min, carb max, fat max
- Cuisine filter, chain vs. independent filter
- Sort options: distance, macro match closeness, confidence tier

---

## 4. External Service Integration

### 4.1 Integration Principles
- All external calls go through service wrappers in `src/services/`
- Each wrapper handles: auth, request formatting, response normalization, error mapping
- No raw external API types leak into business logic

### 4.2 Google Places API
- Purpose: restaurant discovery by location, basic restaurant metadata, photos
- Endpoints used: Nearby Search, Place Details, Place Photos
- Rate limits and quota management
- Response mapping to internal Restaurant model

### 4.3 Nutritionix API
- Purpose: verified nutrition data (Tier 1), ingredient-to-macro lookup (Tier 2/3 final step)
- Endpoints used: Search Instant (branded), Natural Nutrients (common foods)
- Auth: app ID + API key header
- Rate limits and fallback behavior

### 4.4 Claude API
- Purpose: Tier 2 photo estimation (vision), Tier 3 description parsing (text)
- Prompt design: structured output format (ingredient list with quantities)
- Model selection and cost considerations
- Token budget per request, timeout handling
- Prompt versioning strategy

### 4.5 Yelp Fusion API (Optional)
- Purpose: supplementary restaurant data, reviews, photos
- When to use: fallback if Google Places data is insufficient
- Endpoints used: Business Search, Business Details

---

## 5. Data Model / Database Schema

### 5.1 Core Entities
- **User**: id, email, name, auth fields, created/updated timestamps
- **MacroTarget**: userId (FK), calories, proteinG, carbsG, fatG, goal type
- **Restaurant**: id, externalPlaceId, name, address, lat, lng, cuisine tags, chain flag, source, created/updated
- **MenuItem**: id, restaurantId (FK), name, description, photoUrl, category, price, created/updated
- **MacroEstimate** (cache): id, menuItemId (FK), tier (1/2/3), calories, proteinG, carbsG, fatG, confidence, source, ingredientBreakdown (JSON), estimatedAt, expiresAt
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
        int tier
        int calories
        float proteinG
        float carbsG
        float fatG
        string confidence
        string source
        json ingredientBreakdown
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
- Staleness thresholds by tier:
  - Tier 1: 30 days (verified data changes infrequently)
  - Tier 2: 14 days (photos may be updated)
  - Tier 3: 7 days (LLM estimates may improve with model updates)
- Re-estimation: background job or on-demand when stale record is accessed

### 6.2 Cache Invalidation
- Explicit: admin or user flags an estimate as wrong
- Time-based: expiresAt field checked on read
- Source change: if restaurant menu is updated (detected via Place Details)

### 6.3 Application-Level Caching
- Restaurant search results: short-lived in-memory or Redis cache (TBD)
- Nutritionix common food lookups: cache ingredient -> macro mappings (long TTL)
- Rate limit budgets tracked per service per time window

---

## 7. Error Handling and Resilience

### 7.1 External Service Failures
- Circuit breaker pattern per external service
- Retry policy: exponential backoff, max 3 retries for transient errors
- Timeout budgets: per-service configurable timeouts
- Graceful degradation: if one tier fails, fall through to next tier

### 7.2 Rate Limit Management
- Track remaining quota per API key per service
- Proactive throttling before hitting hard limits
- Queue and defer non-urgent requests when near limits
- Alert on sustained high usage

### 7.3 Pipeline Failure Modes
- Tier 1 miss: normal, proceed to Tier 2/3
- Tier 2 failure (vision model error): fall through to Tier 3
- Tier 3 failure (LLM error): return "estimation unavailable" with reason
- Nutritionix lookup partial failure: return partial macros with warning
- All tiers fail: return restaurant/menu item without macro data, flag for retry

### 7.4 User-Facing Error Responses
- Consistent `{ "error": "message" }` format
- Never expose internal service details or API keys
- Actionable messages where possible ("try again", "results may be incomplete")

---

## 8. Performance Considerations

- Pipeline latency budget: target < 2s for cached, < 8s for uncached estimation
- Parallel external API calls where independent (e.g., restaurant fetch + Nutritionix Tier 1 check)
- Database query optimization: lean selects, avoid N+1 on menu item lists
- Batch Nutritionix lookups: group ingredients into single API call where possible
- Background estimation: pre-compute macros for popular restaurants on a schedule
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

## Open Questions

- [ ] PostgreSQL vs. managed alternative (e.g., PlanetScale, Supabase) — decide before schema migration
- [ ] Redis for application caching or start with in-memory and add later?
- [ ] Background job runner: cron, BullMQ, or Vercel Cron?
- [ ] Photo sourcing: rely solely on Google Places photos or allow user uploads?
- [ ] Nutritionix plan tier — which API quota level do we need at launch?
- [ ] Should Tier 2 and Tier 3 run in parallel with a preference for Tier 2 results?
