# Personalized onboarding and trial release

## Intended flow

```mermaid
flowchart LR
  A[Welcome] --> B[Location and coverage]
  B --> C[Fitness goal]
  C --> D[Prior approach]
  D --> E[Approach-specific problem and payoff]
  E --> F[Illustrative goal progress]
  F --> G[Own or assisted meal targets]
  G --> H[Nutrition sources]
  H --> I[Real search preview and five tips]
  I --> J[Account]
  J --> K[Live trial introduction]
  K --> L[Optional reminder permission]
  L --> M[Timeline and live plans]
  M --> N[Purchased meal or search]
```

The redundant introduction after the welcome mosaic is retired.
The goal is chosen before prior approaches and reused for assisted targets and the illustrative payoff.
Known targets bypass body questions and remain editable.
The two approach-specific stories use different copy and illustrations for meal prep, calorie trackers, online research and getting started.
The graph illustrates consistency over time, not measured efficacy or a promised fitness outcome.

## Nutrition policy

The shared macro policy supplies both mobile recommendations and server profile recalculation.
General adult defaults use protein/carbohydrate/fat energy ratios of 25/45/30 for muscle and weight-loss goals, 20/55/25 for performance, and 20/50/30 for maintenance.
These are product defaults within adult reference ranges, not clinically established optimal ratios for each goal.
Reference ranges are from [Health Canada](https://www.canada.ca/en/health-canada/services/food-nutrition/healthy-eating/dietary-reference-intakes/tables/reference-values-macronutrients.html) and [NIH sports nutrition guidance](https://ods.od.nih.gov/factsheets/ExerciseAndAthleticPerformance-HealthProfessional/).
Daily estimates remain divided by 3.5, with rounding at the meal boundary.
Explicit user targets are not replaced by new defaults.
New clients request profile goal schema 2; legacy clients receive a supported maintenance value for performance goals.

## Search and trial behavior

Search keeps the typed query and meal targets through loading, empty results and retries.
A bounded transport timeout leaves a retry action instead of an indefinite loader.
An empty result explains the combined craving and target constraints, with edit and clear actions.
The tour preserves all five numbered tips when a restaurant anchor is unavailable.

Trial eligibility, duration, prices and disclosures come from the store.
Unknown or ineligible offers never promise free access.
The reminder screen asks for optional system permission before plan selection.
The existing reminder provider schedules only against an actual renewable trial expiration after purchase.
Plan selection updates the timeline, charge disclosure and purchase action together.
Restore, cancellation, hard decline and Back remain explicit paths.

## Required evidence

Local iPhone scenarios cover own and assisted targets, goal persistence, all story options, covered and unsupported locations, typed search and empty recovery, five tour steps, live trial terms, reminders, purchase cancellation, restore and hard decline.
Component tests exercise missing tour anchors, late search responses, stalled transports and stale permission continuations.
Delivery requires source-bound native evidence, independent review, PR and main checks, deployment and authenticated product smoke.
Simulator Test Store evidence is distinguished from real Apple billing.
