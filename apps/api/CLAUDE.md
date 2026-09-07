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
