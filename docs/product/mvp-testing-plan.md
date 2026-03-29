# MVP Testing Plan

**Status:** DRAFT
**Geo:** Los Angeles — Hollywood + Silver Lake only
**Method:** In-person recruiting at gyms

---

## Strategy

Before opening Fitsy to the public, validate with real users who match our target persona. Approach gym-goers in person, offer the app for free in exchange for honest feedback. This gives us high-quality, face-to-face signal that surveys and analytics can't match.

Free access during this phase — no paywall. The welcome flow payment screen is bypassed for testers (via promo code or TestFlight-only flag). We're buying feedback with free access, not selling a product yet.

---

## Geo Restriction

All testing is restricted to **Hollywood and Silver Lake, Los Angeles**. This is where our preloaded restaurant data lives. Expanding the geo before the product is validated wastes pipeline costs.

Testers who travel outside this area will see empty results — that's expected and should be communicated upfront.

---

## Recruiting

### Where
- Gyms in Hollywood and Silver Lake (Gold's, Equinox, Barry's, local CrossFit boxes, climbing gyms)
- Target the post-workout crowd — they're thinking about food and macros right then

### Who
- People who visibly track macros (phone out logging food, meal prep containers, shaker bottles)
- Ask: "Do you track your macros?" — if yes, pitch Fitsy. If no, move on.

### Pitch (15 seconds)
> "I'm building an app that finds restaurants near you with meals matching your macros. It's free right now — I just need your feedback. Can I set you up?"

### Onboarding (2 minutes, on the spot)
1. Install via TestFlight link (QR code on phone or printed card)
2. Walk them through first search so they see results immediately
3. Get their name + phone number or Instagram for follow-up
4. Tell them: "Use it for a week, then I'll ask you 5 quick questions"

### Target Numbers
- **10 testers per round** — small enough for personal follow-up, large enough for pattern recognition

---

## Feedback Rounds

### 3 rounds before public launch

| Round | Duration | Goal | Exit Criteria |
|-------|----------|------|---------------|
| **Round 1** | 1 week | Does the core loop work? Do people search, find a restaurant, and go eat there? | 5/10 testers complete at least 1 search → restaurant visit. Major bugs identified and fixed. |
| **Round 2** | 1 week | Is the data trustworthy? Do macro estimates feel accurate? | Testers trust the numbers enough to make food decisions. No "this is obviously wrong" feedback on estimates. |
| **Round 3** | 1 week | Would they pay? Is there a habit forming? | 5/10 testers used the app 3+ times unprompted. At least 3/10 say they'd pay $4/mo. |

### Between Rounds
- Fix the top 3 issues from the previous round before recruiting the next batch
- Each round is a **new batch of 10 testers** (don't reuse — fresh eyes catch different problems)
- Previous-round testers keep access and can keep using the app

### After Round 3
- If exit criteria met across all 3 rounds: **enable the paywall and open to public** (still LA-only initially)
- If not met: run additional rounds until the product earns it. Don't launch a leaky bucket.

---

## Feedback Collection

### Pipeline: Google Form → Google Sheet → LLM Insights

```
Tester gets form link after 1 week
        ↓
Google Form (structured questions)
        ↓
Responses auto-populate Google Sheet
        ↓
After each round: export CSV → Claude for pattern extraction
        ↓
Insights feed into sprint planning + feedback triage
```

### Google Form Questions

**Section 1: Usage** (required)
1. How many times did you open Fitsy this week? — *Dropdown: 0, 1-2, 3-5, 6+*
2. Did you go to a restaurant you found on Fitsy? — *Yes / No*
3. If yes, which restaurant(s)? — *Short answer*

**Section 2: Trust** (required)
4. How accurate did the macro estimates feel? — *Scale 1-5 (1 = way off, 5 = spot on)*
5. Did you trust the numbers enough to make a food decision? — *Yes / Mostly / No*

**Section 3: Experience** (required)
6. What was the most frustrating part? — *Long answer*
7. What did you like most? — *Long answer*

**Section 4: Value** (required)
8. Would you pay $4/month for Fitsy? — *Definitely / Probably / Probably not / Definitely not*
9. Why or why not? — *Long answer*

**Section 5: Open** (optional)
10. Anything else you want us to know? — *Long answer*

### LLM Insight Extraction

After each round closes, export the Google Sheet as CSV and run through Claude:

> Here are {N} feedback responses from Fitsy MVP testers (Round {X}).
>
> 1. **Top 3 pain points** — ranked by frequency, with direct quotes
> 2. **Top 3 things working well** — what to protect
> 3. **Trust signal** — do testers trust the macro data? Summarize the pattern.
> 4. **Willingness to pay** — breakdown of Q8 responses + key reasons from Q9
> 5. **Exit criteria check** — based on the round's goals, did we pass? What's missing?
> 6. **Recommended fixes** — prioritized list for the next sprint

Save each round's analysis to `docs/product/feedback/round-{N}-insights.md`.

### Delivery

- Text/DM the Google Form link to each tester after their 1-week period
- One follow-up nudge 2 days later if they haven't responded
- Target: 8/10 response rate per round (in-person relationship helps)

Feed actionable items into the community feedback forum (`docs/product/specs/community-feedback-forum.md`) — post-launch, testers and users submit feedback directly in-app where others can upvote and comment.

---

## Timeline

| Week | Activity |
|------|----------|
| Week 1 | Round 1: recruit 10 testers at gyms, onboard in person |
| Week 2 | Collect Round 1 feedback, fix top issues |
| Week 3 | Round 2: recruit 10 new testers |
| Week 4 | Collect Round 2 feedback, fix top issues |
| Week 5 | Round 3: recruit 10 new testers |
| Week 6 | Collect Round 3 feedback, make go/no-go decision on public launch |

**Total: ~6 weeks from first recruit to launch decision.**

---

## What We're NOT Testing

- Payment flow (paywall is bypassed for testers)
- Onboarding conversion (testers are hand-onboarded)
- Retention beyond 1 week per round
- Markets outside LA

These get validated after public launch with real organic users.
