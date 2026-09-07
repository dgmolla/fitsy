# scripts - pipeline + harness tooling

## Map
- `preload-ue-first.ts` + `pipeline-*`: the offline data pipeline (backend-owned).
- `verify/`: the check registry - one script per invariant, run by hooks, CI,
  and agents alike (`node scripts/verify/run.mjs --layer=0-2 --scope=changed`).
- `review/`: lens runner + poller (reviews on the Max subscription).
- `deploy/`: prod migrate / OTA / one-command rollback.
- `dev/`: dev-environment provisioning + reset (refuses prod URLs).
- `gen/`: scaffolds routes/screens in the guarded, tested shape (T1).
- `sim/`: simulator CLI for the L7 verifier.

## Non-negotiables
- Imports: `packages/shared` + `apps/api/services` only; never api lib/app or
  mobile code (dependency-cruiser).
- Checks follow the contract in `verify/README.md`: JSON line out, exit 0/1/2,
  a `fix:` hint on failure, and a registry entry (T11).
