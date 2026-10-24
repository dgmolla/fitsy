# LA menu source collision audit

**TL;DR:** Name-only ingestion loses 324 source products across 49 of 100 retained LA menus.

Measured on 2026-10-24 with `npm run audit:menu-identity` against the retained chain rollout UE captures.
The captures date from 2026-09-12 through 2026-09-14.
This is a reproducible sample audit, not a current production-wide census.
The complete machine report contains per-menu counts, source product IDs, sections, prices and capture SHA-256 hashes in [menu-source-collisions-2026-10-24.json](menu-source-collisions-2026-10-24.json).

| Measurement | Result |
|---|---:|
| Retained LA stores audited | 100 |
| Raw titled placements | 14,252 |
| Unique source products, scoped by store | 10,899 |
| Menus with same-name, different-ID products | 49 |
| Same-name collision groups | 311 |
| Source products lost by the old first-title rule | 324 |
| Collision groups with differing prices | 35 |
| Outside-area, missing-coordinate or superseded captures | 0 |

The area is explicitly bounded by latitude 33.7 to 34.35 and longitude -118.75 to -117.65.
Each store contributes its newest available capture once.
Repeated placements of the same UUID do not increase the distinct product count.
Collision groups contain at least two UUIDs with the same trimmed, lowercased title.
Lost products are UUIDs that survive no first-title placement under the old parser.
Distinct UUIDs are preserved conservatively; the count does not claim that every UUID represents a nutritionally different serving.

Two captured Panini menus each contain 129 source products, while title-only parsing retains 122.
Each loses six family orders plus another individual Vegetable Linguine product.
The retained Alfredo Linguine individual order costs $18.39 and its discarded family variant costs $63.29, despite matching names and descriptions.
The committed [regression capture](../../../apps/api/tests/fixtures/menu-source-identity.json) retains the exact relevant source fields and the original full-capture hash.
Its old-parser test failed with one product where two were required.
A separate estimator regression failed with protein values `[80, 80]` instead of `[20, 80]` when same-name responses were reversed.

## Reproduction

```bash
npm run audit:menu-identity -- /path/to/chain-national/ue /tmp/la-menu-source-audit.json
```

This command reads raw captures before title-based parsing, makes no network or database calls, and refuses an empty LA result or an existing output path.
The existing scripts suite tests repeated placements, store scoping, newer-capture selection and geographic exclusions.
The root command uses Node's tsx import hook so a read-only audit does not require tsx's CLI IPC socket.
The capture corpus remains in the rollout evidence archive; the report's hashes bind the inputs without copying the full corpus into the repository.

## Coverage and remaining evidence

The initial database schema cannot reveal products already collapsed into one row because source IDs were never stored.
A fresh full-LA source capture matched to current database rows is still needed for today's complete production count.
The sandbox has no live database credentials or outbound GitHub connectivity, so that census was not measured here.
No production rows or schema were changed.
The local native PostgreSQL recovery attempt stopped at `initdb` because shared-memory creation is denied; Docker was unavailable as well.
The PostgreSQL migration and database-to-menu regressions are included for the existing database-enabled Verify path, and skipped locally when no database URL is available.
The [persistence contract](../backend/idempotent-preload-spec.md) describes the coordinated migration, conservative legacy reconciliation and forced-refresh canary.
