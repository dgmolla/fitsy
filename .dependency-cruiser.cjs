/**
 * Architecture boundaries as code (tenet T3, autonomous-shipping.md).
 * Run via scripts/verify/boundaries.sh; CI job Static (L0-L1).
 *
 * The graph these rules encode:
 *   apps/mobile   -> packages/shared + its own tree only
 *   apps/api/app  -> lib/ and services/ (route layer may call down)
 *   apps/api/lib  -> services/ but never app/
 *   apps/api/services -> never lib/ or app/ (services are the leaf layer
 *                        that talks to the outside world)
 *   packages/shared   -> nothing app-specific
 *   scripts       -> packages/shared + apps/api/services (the external-world
 *                    wrappers are shared with the pipeline); never api app/lib
 *                    or mobile code
 *   no circular imports anywhere
 */
module.exports = {
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(node_modules|\\.next|coverage|\\.expo|mockups)" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
  },
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular imports make code un-refactorable and un-treeshakeable.",
      from: {},
      to: { circular: true, dependencyTypesNot: ["type-only"] },
    },
    {
      name: "mobile-only-shared",
      severity: "error",
      comment: "The mobile app may import packages/shared and its own tree only (T3).",
      from: { path: "^apps/mobile" },
      to: { path: "^(apps/api|prisma|scripts)" },
    },
    {
      name: "api-lib-not-up-to-app",
      severity: "error",
      comment: "apps/api/lib is below the route layer; it must not import app/ (T3).",
      from: { path: "^apps/api/lib" },
      to: { path: "^apps/api/app" },
    },
    {
      name: "api-services-are-leaf",
      severity: "error",
      comment: "services/ talk to the outside world and sit at the bottom; no imports of lib/ or app/ (T3).",
      from: { path: "^apps/api/services" },
      to: { path: "^apps/api/(app|lib)" },
    },
    {
      name: "shared-is-shared",
      severity: "error",
      comment: "packages/shared must not depend on any app or scripts (T3).",
      from: { path: "^packages/shared" },
      to: { path: "^(apps|scripts)" },
    },
    {
      name: "scripts-no-app-internals",
      severity: "error",
      comment:
        "Pipeline scripts may reuse the external-world wrappers (apps/api/services) and packages/shared, " +
        "but never the API's route or lib layers, and never mobile code (T3).",
      // feedback-digest-dryrun grandfathered: it drives an api lib in dry-run
      // mode; belongs in apps/api/tests eventually.
      from: { path: "^scripts/", pathNot: "^scripts/((verify|dev)/|feedback-digest-dryrun\\.ts$)" },
      to: { path: "^apps/(api/(app|lib)|mobile)" },
    },
    {
      name: "mobile-no-direct-fetch-layer",
      severity: "info",
      comment: "Informational: screens should go through lib/api.ts (structural check 8 covers this).",
      from: { path: "^apps/mobile/app" },
      to: { path: "^apps/mobile/lib/supabase" },
    },
  ],
};
