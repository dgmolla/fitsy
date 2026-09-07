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
