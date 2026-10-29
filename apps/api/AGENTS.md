# API agent guide

Run commands from the repository root:

```sh
npm test -w apps/api -- --runInBand
npm test -w apps/api -- --runInBand --runTestsByPath lib/tdeeCalculator.test.ts
npm run lint -w apps/api
npm run type-check -w apps/api
```

`app/api/**/route.ts` handles HTTP input and authentication.
`lib/` owns query construction and application behavior; `services/` wraps external providers.
Shared contracts and pure matching/math live in `packages/shared/src/`.
The API queries preloaded menus; runtime discovery, scraping and macro estimation are forbidden.

New endpoints need real request/response tests, including rejection and recovery paths.
Keep internal behavior real; mock external SDK/HTTP boundaries rather than the module being tested.
Persistence tests belong in `tests/db/` and require the [owned disposable database](../../scripts/verify/README.md).
Direct Jest runs without a database skip those suites and do not prove database behavior.
Never point tests at shared DEV or production or weaken their target guards.

All data handlers require an account session except the exact public exceptions in `app/api/auth-coverage.test.ts`.
Restaurant routes retain server entitlement checks, and response contracts need matching Zod schemas in shared.
Use transactions for multi-record writes and preserve default-deny RLS and provider-qualified menu identities.
Return `{ "error": "message" }` with the appropriate status for failures.
