# Backlog

Cross-cutting tasks that span multiple domains.

- [ ] **CLI-first tooling**: Prefer Supabase, Vercel, and Stripe CLIs for agent-friendly workflows. Lock in Supabase as DB/auth, Vercel for deploy, Stripe for $30/yr + $5/mo subscriptions.
- [ ] **E2E screenshot pipeline**: Once frontend has a login page or dashboard, set up `scripts/e2e-local.sh` — runs Playwright headless against staging, captures screenshots/videos to `e2e/test-results/`, agent reads them visually and posts to PR comments via `gh`. Wire into agent workflow so danger-zone PRs auto-trigger E2E + screenshot review. Blocked on: frontend scaffolding with at least one real route.
- [ ] **Trademark**: File USPTO for "Fitsy". Search availability, submit application, track status.
