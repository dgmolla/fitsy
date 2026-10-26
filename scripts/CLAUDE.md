# scripts - pipeline + harness tooling

## Map
- `preload-ue-first.ts` + `pipeline-*`: the offline data pipeline (backend-owned).
- `verify/`: the check registry - one script per invariant, run by hooks, CI,
  and agents alike (`node scripts/verify/run.mjs --layer=0-2 --scope=changed`).
- `review/`: simple independent review runner and canonical approval adapter.
- `deploy/`: prod migrate / OTA / one-command rollback.
- `dev/`: dev-environment provisioning + reset (refuses prod URLs).
- `gen/`: scaffolds routes/screens in the guarded, tested shape (T1).
- `sim/`: simulator CLI for the L7 verifier.
- `eval/`: offline model evaluations; `npm run eval:chain-match` compares frozen
  LA item/fact decisions with the real alias matcher (baseline is the default).
  Protocol and results: `docs/engineering/pipeline/jev-chain-match-eval.md`.

## Non-negotiables
- Imports: `packages/shared` + `apps/api/services` only; never api lib/app or
  mobile code (dependency-cruiser).
- Keep TypeScript and Jest shared-package mappings pointed at checkout-owned source without relying on workspace links.
- Checks follow the contract in `verify/README.md`: JSON line out, exit 0/1/2,
  a `fix:` hint on failure, and a registry entry (T11).
- Preserve full check output; the verifier retains logs and CI uploads them even after failure.
