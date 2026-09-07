# Developing across git worktrees

We commonly work in several git worktrees at once (one per branch).
A worktree checks out tracked files only, so it is missing the two gitignored things the app needs to run.
Set them up once and the worktree behaves exactly like the primary clone, simulator included.

## TL;DR

Run this once in a new worktree:

```bash
bash scripts/worktree-setup.sh
```

It symlinks `node_modules` from the primary clone and copies the `.env*` files.
Then `npm run dev:mobile` (on a free port) runs the app in the simulator normally.

## The gotcha that cost hours: missing `.env*`

A fresh worktree has no `.env.local`.
Without `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `apps/mobile/lib/supabase.ts` calls `createClient()` at module load and throws `supabaseUrl is required`.
That throw takes down every module that imports it (`usePurchases` -> `(tabs)/_layout` -> ...), so those routes fail to register, the router can't resolve `/`, it falls through to `+not-found`, redirects to `/`, and loops forever ("Maximum update depth exceeded") on a blank screen.

The symptom looks like a native, path, or dependency problem.
It is not.
It is just missing environment variables, because `.env*` is gitignored and therefore absent from the worktree checkout.
`scripts/worktree-setup.sh` copies them, which fixes it.

## node_modules

Symlinked from the primary clone by the same script.
Instant, and it cannot drift from the lockfile because there is no separate install.
A plain `npm install` per worktree also works but is slower and can drift; prefer the symlink.

## When you still need a fresh dev-client build

Rarely.
A dev client is a native binary, so rebuild it only when native dependencies or the Expo SDK change.
JS-only changes (the vast majority) hot-reload over Metro on the existing dev client with no rebuild.

## Metro in a worktree: three gotchas found 2026-09-07

1. The `node_modules` symlink is enough for `tsc`, jest and `next dev`, but Metro resolves the Expo Router entry through the symlink to `../fitsy/node_modules/expo-router/entry`, which is outside its watch folders, and the dev client shows "Unable to resolve module".
   Replace the two symlinks with copy-on-write clones instead: `rm node_modules apps/mobile/node_modules && cp -Rc ../fitsy/node_modules node_modules && cp -Rc ../fitsy/apps/mobile/node_modules apps/mobile/node_modules` (about 12 s on APFS, no extra disk until files diverge).
2. Expo SDK 54 merges the `.env*` files over `process.env` at bundle time, with `.env.development.local` applied last, so a shell `EXPO_PUBLIC_API_URL=...` does NOT win in dev mode.
   To point the simulator at a local API, edit the gitignored `apps/mobile/.env.development.local` and restore it afterwards.
3. A production-mode bundle (`expo start --no-dev --minify`) loads `.env.local`, which carries the PRODUCTION Supabase project and API URL.
   Before a prod-mode walkthrough, export the dev Supabase URL and anon key and the dev API URL in the shell (the shell wins in that mode) and start Metro with `--clear`, because the transform cache does not key on env and will keep serving the previous bundle.
   `next dev --turbopack` also refuses a symlinked `node_modules`; run the worktree API with plain `next dev -p <port>`.
