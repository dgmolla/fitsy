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
Keep exact-fit counts, ranked alternatives and verified serving information distinct in both copy and tests.
