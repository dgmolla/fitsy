# Review Guidelines

These guidelines apply to ANY agent performing a review. There is no
dedicated reviewer role — the team member with the most context on
the area being changed reviews the PR.

## Agent Routing

PRs are automatically routed to reviewers based on changed files.
Multiple agents may review the same PR if it crosses domains.

| Path pattern | Reviewing agent |
|---|---|
| `apps/api/`, `prisma/`, `packages/shared/`, `packages/shared/src/` | **backend** |
| `apps/mobile/` | **frontend** |
| `docs/design/` | **designer** |
| `docs/product/`, `proj-mgmt/okrs*` | **product-manager** |
| `docs/gtm/` | **gtm** |
| `docs/engineering/backend/` | **backend** |
| `.github/`, `.claude/`, `scripts/`, `CLAUDE.md`, `docs/engineering/adrs/`, `docs/engineering/devops/` | **cto** |
| No match / fallback | **cto** |

**Source of truth**: `scripts/route-reviewers.sh`. The workflow calls
this script. A structural test (test 11) verifies this table stays in
sync. When adding agents or paths, update both files.

## How to Review

1. Read the project context (CLAUDE.md) to understand architecture,
   conventions, and danger zones
2. Read YOUR role file to understand your domain constraints
3. Read the PR diff, title, and description
4. Check CI status — if CI is failing, stop and comment "fix CI first"
5. Review against the checklist below, informed by both project AND domain context
6. Post verdict: **APPROVE**, **CHANGES REQUESTED**, or **BLOCK**

## What You Check

### Design judgment (CI can't catch these)

- [ ] Changes match the stated intent (PR title/description)
- [ ] No unnecessary scope creep beyond what was requested
- [ ] New code follows established patterns in the codebase
- [ ] Changes are in the right architectural layer
- [ ] Database mutations use transactions where appropriate
- [ ] New endpoints/functions have tests
- [ ] Error handling follows project conventions
- [ ] Auth/authorization applied to protected routes

### Danger zone awareness

- [ ] Auth changes: verify no privilege escalation, proper scoping
- [ ] Nutrition data changes: verify estimates show confidence ranges, not false precision
- [ ] External API changes: verify rate limiting, caching, error handling

### Harness ratchet (bug fix PRs only)

- [ ] **Detect**: PR adds a test or check that catches this bug if reintroduced.
- [ ] **Constrain or Eliminate**: PR explains what makes this class of
      bug harder to write in the first place.

## Verdict Rules

- **APPROVE**: All checklist items pass. Code is ready to merge.
- **CHANGES REQUESTED**: Fixable issues found. Be specific: file path,
  line number, what's wrong, what to do instead, and which pattern to follow.
- **BLOCK**: Fundamental design issue that needs rethinking, not fixes.

## Review Style

- Review with the context of your domain expertise
- Reference specific project conventions and patterns by name
- Don't nitpick style — that's what linters are for
- If a change follows an existing reviewed pattern, trust the pattern

## Auto-Merge Behavior

When verdict is APPROVE and CI is green:
- Default PRs: auto-merge (squash, delete branch)
- PRs with `human-review` label: post comment requesting human review, do not merge
