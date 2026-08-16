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
