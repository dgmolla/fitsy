# Sprint Index

**Last updated**: 2026-04-25

<!-- CURRENT_SPRINT: sprints/sprint-12 -->

## Active

- [[sprints/sprint-12|Sprint 12: Beta Readiness — TestFlight Round 1+2 + App Store Prep]]

## Upcoming

## Completed

- [[sprints/sprint-11|Sprint 11: Data Pipeline V3 — Quality, Observability, Scale]] — @completed(2026-04-14)
- [[sprints/sprint-10|Sprint 10: MVP Beta Readiness — Auth + Security + Analytics]] — @completed(2026-04-08)
- [[sprints/sprint-9|Sprint 9: Get Users — Data Enrichment + Filters]] — @completed(2026-04-08)
- [[sprints/sprint-8|Sprint 8: Get Users — Mobile Polish + TestFlight]] — @completed(2026-04-06)
- [[sprints/sprint-7|Sprint 7: E2E Validation + TestFlight]] — @completed(2026-03-25)
- [[sprints/sprint-6|Sprint 6: Get Users]] — @completed(2026-03-25)
- [[sprints/sprint-5|Sprint 5: Roll Out]] — @completed(2026-03-26)
- [[sprints/sprint-4|Sprint 4: Implement (auth + E2E)]] — @completed(2026-03-25)
- [[sprints/sprint-3|Sprint 3: Implement (screens + coverage)]] — @completed(2026-03-25)
- [[sprints/sprint-2|Sprint 2: Implement]] — @completed(2026-03-25)
- [[sprints/sprint-1|Sprint 1: Foundation]] — @completed(2026-03-23)

---

## Conventions

- Each sprint file uses Obsidian Kanban format (`kanban-plugin: basic`).
- Sections: `## Backlog`, `## In Progress`, `## Done`. Do **not** add wave subheaders inside them — wave context comes from `#wave-N` tags on each card so Obsidian filters still work.
- Cards: `- [ ] **S-XX Title** — description #role #OKR #wave-N ^dep-S-YY`
  - The S-id and short title go inside one bold span so the eye lands on the topic when scanning.
  - Description is one to two lines after an em-dash. Keep the entry-point file path (`apps/.../foo.ts:42`) inline if the agent will need it. Detailed notes live in the commit message, not the card.
  - When marking done, replace `[ ]` with `[x]` and append `@completed(YYYY-MM-DD)` to the line.
- Dependencies: `^dep-S-XX` tag on the dependent card.
- Completion: `@completed(YYYY-MM-DD)`.
- Wave membership: `#wave-N` tag on each card.
- `CURRENT_SPRINT` HTML comment points to the active sprint.

Reference template: `sprints/sprint-12.md` (the canonical example of this format).
