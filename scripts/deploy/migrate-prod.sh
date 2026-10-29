#!/usr/bin/env bash
# Apply pending Prisma migrations from the existing Vercel production Git build.
# Migrations must be additive (structural check 13 + migration review) so old
# code stays correct while Vercel builds.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$REPO_ROOT"
if [ "${VERCEL:-}" = "1" ]; then
  if [ "${VERCEL_ENV:-}" != "production" ] ||
     [ "${VERCEL_PROJECT_ID:-}" != "prj_z1QTfOgbj4tlm91U2Hf8JXr5k4v4" ] ||
     [ "${VERCEL_GIT_PROVIDER:-}" != "github" ] ||
     [ "${VERCEL_GIT_REPO_OWNER:-}" != "dgmolla" ] ||
     [ "${VERCEL_GIT_REPO_SLUG:-}" != "fitsy" ] ||
     [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ] ||
     [[ ! "${VERCEL_GIT_COMMIT_SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
    echo "refusing: production migration requires fitsy-api Git main production build" >&2; exit 1
  fi
else
  echo "refusing: production migration is owned by the Vercel Git build" >&2; exit 1
fi
# The verified Git main deployment is the sole routine production migration owner.
# Supply both explicit intentions here without changing production credentials.
FITSY_ALLOW_PROD_WRITE=1 node --import tsx scripts/lib/db-target-guard.ts --prod \
  --env=POSTGRES_URL_NON_POOLING --env=POSTGRES_PRISMA_URL
# Check target identity, not a substring that could appear in a password.
# Read credentials only from the existing environment, never argv or output.
node <<'NODE'
const ref = 'zaxkmjqozvmbifiwbxps';
for (const name of ['POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL']) {
  try {
    const url = new URL(process.env[name]);
    // Preserve the existing binding until the owner provisions fitsy_app.
    // Both roles still require the exact production tenant and database.
    const roles = name === 'POSTGRES_PRISMA_URL' ? ['fitsy_app', 'postgres'] : ['postgres'];
    const direct = url.hostname === `db.${ref}.supabase.co` && roles.includes(url.username);
    const username = decodeURIComponent(url.username);
    const options = url.searchParams.getAll('options');
    const keys = [...url.searchParams.keys()];
    // Supavisor also routes a bare postgres role through an exact options reference.
    const optionsRoute = roles.includes(username) && options.length === 1
      && options[0] === `reference=${ref}`
      && new Set(keys).size === keys.length
      && keys.every(key => ['options', 'sslmode', 'pgbouncer'].includes(key));
    const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
      && ((roles.some(role => username === `${role}.${ref}`) && options.length === 0) || optionsRoute);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler)
        || url.pathname !== '/postgres' || !url.password
        || (name === 'POSTGRES_URL_NON_POOLING' && !['', '5432'].includes(url.port))) throw Error();
  } catch {
    console.error(`refusing: ${name} must target the production Supabase database`);
    process.exit(1);
  }
}
NODE
# Refuse an unavailable auth dependency before changing the production schema.
node --import tsx scripts/deploy/rate-limit-preflight.ts
# Owner approval controls SQL selection without authorizing failed-ledger recovery.
node scripts/deploy/pipeline-roles-approval.mjs --deploy
FITSY_ALLOW_PROD_WRITE=1 node --import tsx scripts/deploy/runtime-migrations-preflight.ts --prod
FITSY_ALLOW_PROD_WRITE=1 node --import tsx scripts/deploy/activate-runtime-role.ts --prod
