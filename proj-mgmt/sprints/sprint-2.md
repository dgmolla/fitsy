---
kanban-plugin: basic
---

## Backlog

- [ ] **S-11** Implement preload script — run against 90029 zip, persist to DB #cto #O1 #wave-2 ^dep-S-10
- [ ] **S-12** Implement `GET /api/restaurants` endpoint — query + macro filter + rank #cto #O1 #wave-2 ^dep-S-10
- [ ] **S-13** Implement `GET /api/restaurants/[id]/menu` endpoint — menu items with cached macros #cto #O1 #wave-2 ^dep-S-10
- [ ] **S-14** Write unit tests: macro match scoring + confidence rounding #cto #O1 #wave-2 ^dep-S-10
- [x] **S-15** Auto-route PRs to domain-specific agent reviewers #cto #harness #wave-1 @completed(2026-03-23)
- [ ] **S-16** Scaffold mobile app: Expo Router, bottom tab nav, Search screen shell #frontend #O1 #wave-3 ^dep-S-11

## In Progress

- [ ] **S-10** Monorepo scaffolding — root package.json, workspaces, Prisma schema, first migration #cto #O1 #wave-1

## Done

## Sprint Review

### CTO: Harness evaluation
- [ ] Run `bash scripts/harness-metrics.sh` and record results
- [ ] Identify weakest metric and root cause
- [ ] Create harness fix tasks for next sprint
- [ ] Update CLAUDE.md if architecture/conventions changed
- [ ] Run entropy checks (dead exports, unused deps, stale docs)

### Product Manager: Sprint bookkeeping
- [ ] Update OKR progress in `proj-mgmt/okrs.md`
- [ ] Archive this sprint in `proj-mgmt/sprint.md`
- [ ] Create next sprint board
- [ ] Populate next sprint backlog from OKRs + harness fixes + deferred work

### Human: Review and decide
- [ ] Review all merged PRs, specs, and docs from this sprint
- [ ] Validate agent decisions — correct course if needed
- [ ] Review foundation docs — has vision/strategy shifted?
- [ ] Prioritize next sprint backlog
- [ ] Review harness metrics — agree with fix plan?

%% kanban:settings
{"kanban-plugin":"basic","lane-width":300}
%%
