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
| `/welcome/problem` | fresh install | "Find meals that fit"; login link reads "Have an account? Log in" | animated dish columns; first onboarding screen |
| `/welcome/promise` | legacy links | redirects to location | Retired duplicate introduction |
| `/welcome/goal` | covered area | `goal-performance`, `goal-build_muscle`, `goal-lose_fat` | Goal personalizes the story and assisted targets |
| `/welcome/tried` | goal choice | `tried-meal_prep`, `tried-calorie_apps` | Four prior approaches personalize the response, fitness payoff and tour |
| `/welcome/response` | prior approach | `welcome-continue` | Relevant response, then a personalized fitness-goal payoff |
| `/welcome/location-permission` | welcome CTA | `location-use-current`, `location-choose-area` | GPS primary; manual area fallback; actual coverage determines continuation |
| `/welcome/value-abundance` | legacy links only | redirects to value-payoff | Retired benefits screen |
| `/welcome/value-payoff` | personalized response | `fitness-payoff-diagram`, `welcome-continue` | Connects meal targets and eating out to fitness goals; meal-prep path shows home and restaurant choices |
| `/welcome/goal-payoff` | approach-specific payoff | `goal-progress-graph` | Clearly illustrative goal-specific consistency graph; then target choice |
| `/welcome/how-it-works` | confirmed meal targets | `nutrition-source-published`, `nutrition-source-estimated` | Source transparency and portion uncertainty before discovery |
| `/welcome/target-setup` | fitness payoff | `target-mode-known`, `target-mode-estimate`, `target-use-saved` | Choose then confirm own or assisted targets; saved-target shortcut still visits nutrition trust |
| `/welcome/macros-intro` | optional target help | `welcome-continue` | Returns to target choice |
| `/welcome/height`, `/welcome/weight`, `/welcome/age`, `/welcome/sex`, `/welcome/activity` | estimate choice only | `welcome-continue` | Original profile questions; known targets bypass body questions |
| `/welcome/tuning` | known-target choice or profile questions | `meal-target-calories` | Editable per-meal targets; goal and edits persist |
| `/welcome/preview` | nutrition trust | `preview-pick-1`, `preview-guide` | Real search, restaurant photos, three visible picks and guided tour; locked menus and extra results open plans |
| `/welcome/trial` | account creation with selected preview | `trial-offer-note` | Free trial promise only with live eligibility; otherwise plan benefits |
| `/welcome/trial-reminder` | trial introduction | `trial-reminder-allow`, `trial-reminder-skip` | Optional OS permission; schedule only after verified trial purchase |
| `/welcome/payment` | reminder screen or locked action | `paywall-plan-yearly` | Live plans; root launch has no fabricated Back; explicit decline resets the stack |
| `/welcome/notification-permission` | legacy links | `notification-allow`, `notification-skip` | Remind me directly asks OS permission; no choices; then selected meal |
| `/auth/login` | "Have an account? Log in" link on the problem screen (router.push, no intermediate screen) | "Welcome back", "Continue with Apple" | Apple/Google/email in one screen |
| `/welcome/signin` | locked preview action | `signup-selected-restaurant`, `signup-apple`, `signup-google` | Selected restaurant/search/targets remain visible; authenticated onboarding continues to trial introduction |
| `/auth/reviewer` | App Store review deep link | - | demo access |
| `/macro-setup` | signed in, no targets | - | standalone target editor |
| `/(tabs)/search` | cold start when entitled; tab bar | "Search restaurants or dishes" | same discovery component as preview; tabs require entitlement; hard paywall after decline by default |
| `/(tabs)/saved` | tab bar | - | saved restaurants/items |
| `/(tabs)/profile` | tab bar | "YOUR GOAL" | targets, plan, sign out |
| `/restaurant/[id]` | tapping a search result | restaurant name | menu + macro detail |
| `/welcome/leave-review` | legacy links only | redirects to permission/out-of-area | no rating prompt in onboarding |
| `/welcome/resubscribe` | cold start when lapsed | - | win-back screen |
| out-of-area state | search preview returns 0 nearby | "Keep me posted" (inline on the search screen, not a separate route) | LA-only launch teaser; `/welcome/out-of-area` also exists in the onboarding flow |
| `/notification-settings` | Profile -> Notifications; trial reminder | `reminder-permission`, `reminders-device-settings` | Device notification settings and actual upcoming schedule; no per-reminder configuration |
| `/feedback-board` | profile | - | feedback list |

Known flake: first cold start after install animates for ~2s before "continue"
is tappable - flows use extended waits on that screen.

E2E uses the identified local build produced by `scripts/sim/product-flow.mjs`:
embedded Release for normal app flows, or signed Debug with its owned Metro for
RevenueCat Test Store. Both use dev services; fresh-account runs explicitly reset
the disposable simulator keychain. See `docs/engineering/devops/shipping.md` for
the blocking evidence procedure. A normal dev-client launcher is not this build.
