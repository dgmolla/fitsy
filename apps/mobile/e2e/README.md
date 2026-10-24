# Native walkthrough helpers

The canonical scenario, ownership, evidence and publication procedure is in `docs/engineering/devops/shipping.md`.
Inspect CI's dynamic selection with `npm run verify:sim-plan` from the repository root.
The maintained path-to-flow mapping lives in `scripts/verify/impact-plan.mjs`; extend it and its table-driven tests when adding screen coverage.
Unmapped mobile paths expand to the full flow set, and `needs-sim` forces flows for otherwise non-mobile changes.
CI execution does not replace the local source-bound product-flow gate.
Run the native accessibility helper regression tests from the repository root with `node --test apps/mobile/e2e/helpers/native-ax.test.mjs` when changing these helpers.

Mobile MCP text dumps include state names in their legend.
Use `isNativeFocused(dump, testID)` on a fresh observation before typing and `assertNativeValue(dump, testID, expected)` afterward.
These helpers inspect the exact element row and fail closed for missing or duplicate selectors.
They do not prove search results; assert the returned dish or empty-state recovery separately and retain the complete raw tool trace.
