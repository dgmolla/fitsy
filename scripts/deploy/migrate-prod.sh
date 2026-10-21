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
elif [ "${FITSY_ALLOW_PROD:-}" = "1" ] && [ "${GITHUB_ACTIONS:-}" != "true" ]; then
  # Explicit existing operator recovery, never a second routine CI writer.
  : "${PROD_DATABASE_URL:?PROD_DATABASE_URL required for operator migration}"
  export POSTGRES_URL_NON_POOLING="$PROD_DATABASE_URL" POSTGRES_PRISMA_URL="$PROD_DATABASE_URL"
else
  echo "refusing: production migration is owned by the Vercel Git build" >&2; exit 1
fi
# Check target identity, not a substring that could appear in a password.
# Read credentials only from the existing environment, never argv or output.
node <<'NODE'
const ref = 'zaxkmjqozvmbifiwbxps';
for (const name of ['POSTGRES_URL_NON_POOLING', 'POSTGRES_PRISMA_URL']) {
  try {
    const url = new URL(process.env[name]);
    const direct = url.hostname === `db.${ref}.supabase.co` && url.username === 'postgres';
    const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
      && decodeURIComponent(url.username) === `postgres.${ref}`;
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler)
        || url.pathname !== '/postgres' || !url.password
        || (name === 'POSTGRES_URL_NON_POOLING' && !['', '5432'].includes(url.port))) throw Error();
  } catch {
    console.error(`refusing: ${name} must target the production Supabase database`);
    process.exit(1);
  }
}
NODE
npx prisma migrate status --schema prisma/schema.prisma || true
npx prisma migrate deploy --schema prisma/schema.prisma
