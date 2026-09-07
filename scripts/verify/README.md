# scripts/verify

One script per check.
CI, the local pre-push hook, and agents all call the same scripts; nothing is implemented twice.
Design: `docs/engineering/devops/autonomous-shipping.md` §3.

## Check contract

```
scripts/verify/<name>.sh [--scope=changed|all]
exit 0 = pass, 1 = fail, 2 = skipped (not applicable here)
stdout: one JSON line {"name","status","summary","fix"}
stderr: human-readable detail
```

`fix` is mandatory on failure: what a context-free author should run or change.

## Registry

`registry.yml` lists every check with its layer, tier, path filters, blocking mode, and the reason it exists.
A check without a registry entry, or an entry without a script, is itself a failure (tenet T11).

| Check | Layer | What it proves |
|---|---|---|
| `structural.sh` | 0 | the growing invariant checklist (`scripts/structural-tests.sh`) |
| `secrets.sh` | 0 | no hardcoded keys, committed .env, or build output in the diff |
| `lint.sh` | 1 | eslint clean across workspaces |
| `typecheck.sh` | 1 | tsc clean per workspace |
| `domain-check.sh` | 1 | the PR touches a single domain |
| `test.sh` | 2 | api coverage gate + scripts tests |
| `build.sh` | 3 | production API build, no stray compiled output |
| `dev-drift.sh` | 3 | the dev environment has every migration on `main` and holds seed data |

Callers: `.githooks/pre-push` (layers 0-1, changed scope), `npm run verify` (0-2), `npm run verify:all`, and `.github/workflows/verify.yml` (one thin job per layer).
