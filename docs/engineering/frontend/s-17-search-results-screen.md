# S-17: Search Results Screen — Macro Inputs & Restaurant List

## Overview

This spec covers the implementation of a fully functional Search screen in the Fitsy mobile app. The screen lets users enter macro targets, fetches matching restaurants from the API, and displays results as scored restaurant cards.

## Data Flow

```mermaid
flowchart TD
    U([User]) -->|types macro targets| MacroInputs
    MacroInputs -->|debounced 600ms| apiClient
    apiClient -->|GET /api/restaurants?lat=&lng=&protein=&carbs=&fat=&calories=| API[(Next.js API)]
    API -->|RestaurantsApiResponse| apiClient
    apiClient -->|RestaurantResult[]| SearchScreen
    SearchScreen -->|renders| FlatList
    FlatList -->|per item| RestaurantCard
    RestaurantCard -->|displays| Name
    RestaurantCard -->|displays| Distance
    RestaurantCard -->|displays| BestMatch[Best Match Item + Macros]
    RestaurantCard -->|displays| ConfidenceBadge[Confidence Badge]
```

## Components

### `apps/mobile/lib/apiClient.ts`

Typed wrapper around the base `api.get` helper. Accepts a partial `MacroTargets` object plus the hardcoded lat/lng and builds the query string from non-empty fields only.

```
fetchRestaurants(params: FetchRestaurantsParams): Promise<RestaurantResult[]>
```

### `apps/mobile/components/RestaurantCard.tsx`

Stateless display component. Props:

| Prop | Type | Description |
|------|------|-------------|
| `item` | `RestaurantResult` | Full restaurant row from API |

Renders:
- Restaurant name (bold)
- Address (secondary text)
- Distance in miles
- Best match item name + macro summary (protein / carbs / fat / cals) or "No macro data"
- Confidence badge: HIGH=green, MEDIUM=amber, LOW=gray

### `apps/mobile/app/(tabs)/search.tsx`

Root screen. Manages:
- Local state: `protein`, `carbs`, `fat`, `calories` (string inputs)
- Debounced effect (600ms) triggering `fetchRestaurants`
- `results`, `loading`, `error` state
- Renders macro input row, location label, loading indicator or error message, and `FlatList` of `RestaurantCard`

## Location

Hardcoded to Silver Lake, LA ZIP 90029 center:
- `lat`: `34.0869`
- `lng`: `-118.3269`

Real location will be added in a later sprint.

## Environment

API base URL is read from `EXPO_PUBLIC_API_URL` with fallback to `http://localhost:3000`.

## Colors

| Token | Value |
|-------|-------|
| primary green | `#2D7D46` |
| text | `#111827` |
| secondary | `#6B7280` |
| border | `#D1D5DB` |
| amber | `#D97706` |
| error red | `#DC2626` |

## Out of Scope

- Navigation to restaurant detail screen (S-19)
- Real device location (future sprint)
- Pagination / infinite scroll
