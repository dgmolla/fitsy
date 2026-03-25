# Backlog

Cross-cutting tasks that span multiple domains.

- [ ] **CLI-first tooling**: Prefer Supabase, Vercel, and Stripe CLIs for agent-friendly workflows. Lock in Supabase as DB/auth, Vercel for deploy, Stripe for $30/yr + $5/mo subscriptions.
- [ ] **Fix E2E video pipeline**: S-34 was built against Vercel preview deploys (now disabled). Rework to run locally: agent runs `npm run build && npm start` (production build on localhost), Playwright records video, agent uploads and embeds in PR description. Update frontend/backend role files to require video for frontend PRs. Delete or disable the broken CI workflow (S-34c).
- [ ] **Trademark**: File USPTO for "Fitsy". Search availability, submit application, track status.
