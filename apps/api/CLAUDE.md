# apps/api - Next.js API backend

Read-only query layer over the preloaded DB; no runtime external API calls.

## Commands (from repo root)
```bash
npm run dev:api                          # dev server (dev DB by default)
npm run test:coverage -w apps/api        # unit tests + coverage gate
npx jest tests/db -w apps/api            # real-DB tests (needs POSTGRES_PRISMA_URL)
scripts/gen/route.sh <path> --auth=...   # scaffold a route the correct shape
```

## Layering (enforced by dependency-cruiser, T3)
`app/api/**/route.ts` -> `lib/` -> `services/`. `services/` is the only place
that talks to the outside world; never import upward.

## Non-negotiables
- Every route under `/api/restaurants` enforces entitlement server-side
  (`optionalSubscription` teaser-lock or a 402 gate); structural check 12.
- Response shapes get a zod twin in `packages/shared/src/contracts/` (T4).
- Mock only the external boundary (`services/*`, `lib/supabase`); own-code
  mocks are counted by the `own-code-mocks` check - prefer `tests/db/`.
- Errors: `{ "error": "message" }` + proper status. Multi-record mutations in
  transactions.

## Search changes require explicit scope

Be very wary of touching preview or main search.
Onboarding, copy, paywall and conversion work must not change search queries, ranking, filters, relevance, pagination or serving interpretation unless the user's request explicitly requires that search change.
Keep marketing copy independent of search calculations; do not add target-fit counts or introduce result filters to support a claim.
For an explicitly requested search fix, reproduce it through the real user flow first, make the smallest change that restores the intended behavior, and capture before/after preview and authenticated main-search results with all default targets retained.
Cover common cravings such as pizza, restaurant and cuisine names, sparse coverage, absent dishes, clearing the query, and pagination when affected.
API agreement and a successful empty state alone do not prove useful search behavior.
