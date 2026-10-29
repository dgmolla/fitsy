# Mobile agent guide

Run commands from the repository root:

```sh
npm test -w apps/mobile -- --maxWorkers=1 --workerIdleMemoryLimit=256MB
npm test -w apps/mobile -- --selectProjects lib --runInBand
npm run lint -w apps/mobile
npm run type-check -w apps/mobile
npm run verify:sim-plan
npm run verify:product-plan
```

Expo Router screens live in `app/`, reusable UI in `components/`, and state/hooks/adapters in `lib/`.
Pure recommendation math belongs in `onboardingRecommendations.ts`, `macroCalculator.ts` and shared utilities, with no runtime dependency on storage or authentication.
API contracts come from `@fitsy/shared`; `lib/apiClient.ts` supplies typed operations through authenticated transport in `lib/api.ts`.

Test visible behavior through rendered screens and real hooks; mock only external HTTP, native SDKs and storage.
Use fixed clocks and varied fixtures; derive discovery assertions from the current result rather than a seeded restaurant/dish name.
For changed mobile journeys, update `e2e/flows/` and follow [the fixture/run guide](e2e/README.md).
Wrap every iOS simulator or Maestro command with the shared lock:

```sh
lockf -t 3600 ~/fitsy-refactor/loop/sim.lock node scripts/sim/ci.mjs --scope=flow --flows=<selected-flows> --udid=<owned-UDID>
```

Use the impact-selected flows and the same candidate API origin in Metro, Maestro and fixtures.
`dev.fitsy.org` stays pinned to `dev`; candidate API behavior requires the PR's Ready preview.
Preserve independent search filters, macro confidence ranges, account ownership and store/native compatibility.
Test Store, RevenueCat sandbox and production proof are distinct; follow [shipping](../../docs/engineering/devops/shipping.md) for required evidence and release approvals.
