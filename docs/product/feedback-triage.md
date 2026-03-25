# Feedback Triage Playbook

This document is the operating manual for processing incoming user feedback
during the MVP phase. Run this playbook once per sprint (weekly).

---

## 1. Where Feedback Lives

| Channel | Location |
|---------|----------|
| In-app "Send Feedback" | `feedback@fitsy.app` inbox |
| App Store reviews (post-launch) | App Store Connect → Reviews |
| TestFlight beta feedback | App Store Connect → TestFlight → Feedback |
| Direct messages / social | Founder's discretion; copy paste into email thread |

For MVP, the primary source is the email inbox. All other channels are
reviewed opportunistically during triage.

---

## 2. Triage Cadence

- **When**: Every Monday morning, before sprint planning.
- **Time budget**: 30 minutes maximum. If the inbox is too full, timebox and
  carry the rest to next week — do not skip sprint planning.
- **Who**: PM (founder during MVP phase).

---

## 3. Categorization

Assign exactly one category to each feedback item.

| Category | Definition | Examples |
|----------|------------|---------|
| **Bug** | Something is broken or behaving incorrectly | App crashes, wrong macro values, search returns no results when restaurants exist |
| **Feature request** | A capability the user wants that does not exist | "I want to filter by vegan", "Can you add Chipotle?" |
| **Content issue** | A specific data problem (wrong menu item, missing restaurant, bad photo) | "Shake Shack burger macros are wrong", "My local Thai place isn't listed" |
| **Compliment** | Positive signal, no action required | "Love the app!", "This saved my meal prep" |
| **Unclear** | Not enough information to categorize | No description, test submissions |

If an item spans two categories (e.g., a bug report that also suggests a fix),
use the primary issue type and note the secondary in the ticket description.

---

## 4. Priority Matrix

After categorizing, assign a priority using frequency x severity.

### Severity Scale

| Level | Definition |
|-------|------------|
| **S1 — Critical** | Prevents core use case (cannot search, cannot see macros, app crashes on launch) |
| **S2 — High** | Degrades core use case significantly (wrong macros shown, search returns bad results) |
| **S3 — Medium** | Noticeable friction but workaround exists (slow load, confusing UI element) |
| **S4 — Low** | Polish / nice-to-have (typo, minor visual glitch) |

### Frequency Scale

| Level | Definition |
|-------|------------|
| **F3 — Multiple reports** | 3+ separate users reported the same issue |
| **F2 — Repeat** | 2 users reported the same issue |
| **F1 — Single** | Only one report so far |

### Priority Matrix

|  | S1 Critical | S2 High | S3 Medium | S4 Low |
|--|-------------|---------|-----------|--------|
| **F3 Multiple** | P0 — fix this sprint | P1 — fix this sprint | P2 — next sprint | P3 — backlog |
| **F2 Repeat** | P0 — fix this sprint | P1 — fix this sprint | P3 — backlog | P4 — icebox |
| **F1 Single** | P1 — fix this sprint | P2 — next sprint | P4 — icebox | P4 — icebox |

**P0**: Drop everything, fix before end of current sprint.
**P1**: Enters current sprint if capacity allows; otherwise top of next sprint.
**P2**: Enters next sprint backlog.
**P3**: Backlog — reviewed at quarterly OKR review.
**P4 (icebox)**: Logged but not scheduled; revisit if frequency increases.

---

## 5. Triage Process

### Step-by-step

```
Raw feedback → Read & understand → Categorize → Assess severity → Check frequency → Assign priority → Create ticket or note → Update triage log
```

**Step 1 — Read the inbox.** Open `feedback@fitsy.app`. Read every unread
message. Do not reply yet.

**Step 2 — Deduplicate.** Group messages that describe the same issue. Each
unique issue gets one ticket regardless of how many users reported it. Frequency
count goes on the ticket.

**Step 3 — Categorize.** Assign one category from section 3.

**Step 4 — Assess severity.** Use the severity scale above. When in doubt,
err on the side of higher severity for anything touching macro accuracy (this
is a health-adjacent feature — see Danger Zones in CLAUDE.md).

**Step 5 — Assign priority.** Cross-reference category + severity + frequency
in the matrix.

**Step 6 — Create tickets.**
- Bug / Content issue → create a task in `proj-mgmt/sprint.md` (or the current
  sprint board) with format: `[BUG] Short description — P{level}, S{level}, F{count}`.
- Feature request → add to backlog section with format:
  `[FR] Short description — linked OKR: {OKR key or "none"}`.
- Compliment → no ticket; add a one-line note to the sprint retro doc under
  "What's working".
- Unclear → reply asking for clarification; flag for next triage cycle.

**Step 7 — Mark as triaged.** In the email inbox, apply a "triaged" label (or
move to a "Triaged" folder). Do not delete.

**Step 8 — Update triage log.** Append a row to the table in section 7 of this
document.

---

## 6. Response SLA Targets (MVP Phase)

These are targets, not guarantees. MVP is a single-founder operation.

| Category | Acknowledgement | Resolution target |
|----------|----------------|-------------------|
| Bug — P0 | Same day | This sprint (within 7 days) |
| Bug — P1 | Within 3 days | Next sprint (within 14 days) |
| Bug — P2/P3 | Within 7 days | Backlog (no fixed date) |
| Feature request | Within 7 days | Backlog (no fixed date) |
| Content issue | Within 7 days | Next sprint if data-only fix; engineering sprint if schema change |
| Compliment | Optional — a brief "thanks" reply is a nice touch | N/A |

**Acknowledgement** = reply to the user's email (or App Store review response)
confirming receipt and category. Keep it short:

> "Thanks for reporting this! We've logged it and will look into it. — Fitsy
> team"

Do not promise a fix date unless it is a P0.

---

## 7. Triage Log

Append a row here after each triage session.

| Date | Inbox count | Bugs | Feature requests | Content issues | Compliments | Unclear | P0s created | Notes |
|------|-------------|------|------------------|----------------|-------------|---------|-------------|-------|
| — | — | — | — | — | — | — | — | First triage session pending beta launch |

---

## 8. Escalation

- **Macro accuracy complaint** — always treat as S2 or higher regardless of
  frequency. Tag with `nutrition-accuracy` label. Loop in CTO if a systemic
  data pipeline issue is suspected.
- **Privacy complaint** — immediately escalate to founder; do not triage
  through normal flow.
- **Legal / liability language in feedback** — do not reply; escalate to
  founder immediately.
- **Volume spike** (>20 new items in a week pre-100 users) — something likely
  broke; skip the standard triage flow, scan for a common theme, and treat as
  a potential P0 investigation.
