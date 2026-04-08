# Backlog

Cross-cutting tasks that span multiple domains.

- [ ] **GPS location** — Replace hardcoded Silver Lake coords with `expo-location`; request permission on search screen; pass lat/lng to API (`/api/restaurants` `lat`/`lng` params → Google Places Nearby Search). MVP ships Silver Lake only. #frontend #backend
- [ ] **AI macro source disclosure** — In restaurant detail screen, distinguish menu items with AI-estimated macros from those sourced from published nutrition data. Show a subtle indicator (e.g., confidence range or source badge) only on items where `MacroEstimate.source = "haiku"`. Do not label all items — chains with verified published data should appear clean. #frontend #backend
- [ ] **CLI-first tooling**: Prefer Supabase, Vercel, and Stripe CLIs for agent-friendly workflows. Lock in Supabase as DB/auth, Vercel for deploy, Stripe for $30/yr + $5/mo subscriptions.
- [ ] **Trademark**: File USPTO for "Fitsy". Search availability, submit application, track status.
- [ ] **S-58** Recruit first 10 TestFlight testers — send invites, set up onboarding message, confirm installs #cto #O1 ^blocked-until-mvp-complete
- [ ] **Community feedback forum** — Public in-app forum with upvotes, comments, "Founder's Voice" badge. Spec: `docs/product/specs/community-feedback-forum.md` #frontend #backend
- [ ] **Design token system** — Add spacing scale (xs/sm/md/lg/xl) + `Stack`/`Row` layout components to theme. Replace hardcoded pixel values across all screens. #frontend
- [ ] **HealthKit integration** — Read daily macro budget + logged meals, write meal entries on restaurant pick. HealthKit is the hub — indirect sync covers MFP/Lose It/etc. Use `expo-health-kit`. Enables "remaining budget" ranking in search results. #frontend #backend
- [ ] **SEO optimization** — Create web pages with macro/nutrition data per restaurant, optimized for search discovery. Consider static/server-rendered pages with structured data (schema.org). #frontend #backend #growth
