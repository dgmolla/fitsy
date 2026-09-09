/**
 * Mutation testing (tenet T5): the gate on agent-written tests. Runs in
 * shadow via scripts/verify/mutation.sh - incremental, scoped to
 * apps/api/lib and packages/shared logic, thresholds.break ratchets upward
 * as the score stabilizes (autoship rollout step 10).
 */
export default {
  testRunner: "jest",
  jest: {
    projectType: "custom",
    configFile: "apps/api/jest.config.js",
    // Jest's related-test discovery misses consumers through the shared barrel.
    enableFindRelatedTests: false,
  },
  mutate: [
    "apps/api/lib/restaurantMenuService.ts",
    "apps/api/lib/macroScoring.ts",
    "apps/api/lib/macroTargetParams.ts",
    "apps/api/lib/macroScoreSql.ts",
    "packages/shared/src/utils/macroScoring.ts",
    "apps/api/lib/rateLimit.ts",
    "apps/api/lib/pricing.ts",
    "packages/shared/src/utils/dateUtils.ts",
    "packages/shared/src/utils/macroProvenance.ts",
  ],
  incremental: true,
  incrementalFile: ".evidence/mutation/stryker-incremental.json",
  reporters: ["clear-text", "json"],
  jsonReporter: { fileName: ".evidence/mutation/report.json" },
  thresholds: { high: 80, low: 60, break: 50 },
  tempDirName: ".stryker-tmp",
};
