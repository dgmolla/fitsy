# Feature map

How to drive this app, for E2E flows (`e2e/flows/`) and the agent-driven
verifier (`scripts/sim/sim`). One row per screen: route, how you get there,
and a stable anchor (visible text today; `testID` as they land - the lint
warns on interactive elements without one).

Cold start: `app/index.tsx` redirects by state - fresh install -> `/welcome/problem`;
signed in + entitled (or in trial) -> `/(tabs)/search`; lapsed -> `/welcome/resubscribe`;
signed in without targets -> `/macro-setup`.

| Route | Reached by | Anchor (visible text) | Notes |
|---|---|---|---|
| `/welcome/problem` | fresh install | "continue" (lowercase CTA); login link reads "Have an account? Log in" | animated dish columns; first onboarding screen |
| `/welcome/*` (story flow) | tapping continue repeatedly | per-screen headlines | ~20 screens: tried, promise, how-it-works, value-*, data-scale, sex, age, height, weight, activity, goal, dietary, macros-*, tuning, finding, response, location/notification permission, leave-review, trial, payment; email signup at `/auth/register` |
| `/auth/login` | "Have an account? Log in" link on the problem screen (router.push, no intermediate screen) | "Welcome back", "Continue with Apple" | Apple/Google/email in one screen |
| `/welcome/signin` | within the onboarding story flow | "Continue with Apple" | onboarding-time account creation |
| `/auth/reviewer` | App Store review deep link | - | demo access |
| `/macro-setup` | signed in, no targets | - | standalone target editor |
| `/(tabs)/search` | cold start when entitled; tab bar | "Search restaurants or dishes" | main surface; teaser lock when unentitled |
| `/(tabs)/saved` | tab bar | - | saved restaurants/items |
| `/(tabs)/profile` | tab bar | "YOUR GOAL" | targets, plan, sign out |
| `/restaurant/[id]` | tapping a search result | restaurant name | menu + macro detail |
| `/welcome/resubscribe` | cold start when lapsed | - | win-back screen |
| out-of-area state | search preview returns 0 nearby | "Keep me posted" (inline on the search screen, not a separate route) | LA-only launch teaser; `/welcome/out-of-area` also exists in the onboarding flow |
| `/feedback-board` | profile | - | feedback list |

Known flake: first cold start after install animates for ~2s before "continue"
is tappable - flows use extended waits on that screen.

E2E flows run against the `e2e-simulator` EAS build (embedded bundle, dev API;
Supabase env intentionally unset - the app treats it as signed-out, which the
cold-start flow depends on). A dev-client install will NOT work with
`clearState` flows: it lands in the launcher UI.

Simulator basics: `scripts/sim/sim boot`, install the e2e (or dev-client) build, then
`sim launch <bundle-id>`. Metro logs: `sim logs --grep ERROR`.
