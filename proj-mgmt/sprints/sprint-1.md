---
kanban-plugin: basic
---

## Backlog

- [ ] **S-04** Write Business Model doc — monetization strategy, unit economics, pricing #product-manager #O1 #wave-2 ^dep-S-01
- [ ] **S-05** Fill in CLAUDE.md Architecture from system design — repo structure, database schema, service boundaries #cto #O1 #wave-2 ^dep-S-02
- [ ] **S-06** Write Component Library spec — core UI components, design tokens, variants and states #designer #O1 #wave-2 ^dep-S-03
- [ ] **S-07** Write Testing Strategy — unit/integration/e2e approach, what to mock, coverage targets #cto #O1 #wave-3 ^dep-S-05
- [ ] **S-08** Write GTM Strategy — target audience, channels, launch plan for first 10 users #gtm #O1 #wave-3 ^dep-S-04
- [ ] **S-09** Set up CI pipeline — GitHub Actions for structural tests, type checking, unit tests #cto #O2 #wave-3 ^dep-S-05

## In Progress

- [ ] **S-01** Write Vision PRD — product vision, target users, competitive landscape, north star metrics #product-manager #O1 #wave-1
- [ ] **S-02** Write System Design doc — macro estimation pipeline, data flow, API architecture, external service integration #cto #O1 #wave-1
- [ ] **S-03** Write Design Brief — brand identity, mobile-first UX principles, core screen flows #designer #O1 #wave-1

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
