# apps/mobile - Expo React Native client

## Commands (from repo root)
```bash
npm run dev:env                # point local at the dev environment first
npm run dev:mobile             # expo dev client
npm test -w @fitsy/mobile      # unit tests
scripts/sim/sim status         # simulator CLI (boot/screenshot/logs/...)
scripts/gen/screen.sh <route>  # scaffold a screen the correct shape
```

## Non-negotiables
- Mobile imports `packages/shared` and its own tree only (dependency-cruiser).
- Network goes through `lib/api.ts`; entitlement UX is client-side only - the
  server independently enforces it.
- Interactive elements carry `testID` (lint warns); new screens get a
  `FEATURE_MAP.md` row; flow-critical screens get a Maestro flow in `e2e/flows/`.
- JS-only changes ship as OTA; anything native (app.config.ts, package.json,
  eas.json, ios/, android/) needs a binary - deploy.yml guards this by tag.

## Preserve discovery behavior

Treat ranking, qualification, query relevance and serving interpretation as product behavior, even when the task starts in onboarding or a paywall.
Preview and presentation changes must preserve the existing discovery policy unless changing that policy is part of the task's stated outcome.
A paywall count definition must not silently become a result filter in shared search.
When matching behavior changes, record before/after results for representative real cravings with full default targets in both preview and main search, including a common craving such as pizza, sparse matches and no relevant dishes.
Validate relevance and usefulness against the intended user outcome; an empty state or exact API agreement alone does not prove the new matching policy is correct.
Keep ranking and verified serving information accurate in both copy and tests.

## Search changes require explicit scope

Be very wary of touching preview or main search.
Onboarding, copy, paywall and conversion work must not change search queries, ranking, filters, relevance, pagination or serving interpretation unless the user's request explicitly requires that search change.
Keep marketing copy independent of search calculations; do not add target-fit counts or introduce result filters to support a claim.
For an explicitly requested search fix, reproduce it through the real user flow first, make the smallest change that restores the intended behavior, and capture before/after preview and authenticated main-search results with all default targets retained.
Cover common cravings such as pizza, restaurant and cuisine names, sparse coverage, absent dishes, clearing the query, and pagination when affected.
API agreement and a successful empty state alone do not prove useful search behavior.
