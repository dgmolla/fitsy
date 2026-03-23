# Fitsy Design Brief — Spec Outline

> **Status**: Draft outline for human review
> **Author**: Designer
> **Date**: 2026-03-22

---

## 1. Brand Identity

- **Name rationale**: "Fitsy" — approachable contraction of "fitness," conveys health-awareness without clinical overtones; easy to say, spell, and search
- **Brand personality**: Knowledgeable but not preachy; encouraging, not judgmental; practical over aspirational
- **Tone of voice**: Conversational, concise, confident — "your macro-savvy friend who knows every menu in town"
- **Positioning statement**: Fitsy sits between calorie-counter apps (too clinical) and restaurant discovery apps (nutrition-blind) — it owns the intersection

## 2. Color Palette and Typography Direction

- **Primary palette**: Fresh, energetic — lean toward greens and teals that signal health without looking medicinal
- **Accent colors**: Warm accent (coral or amber) for CTAs, highlights, and macro-hit indicators
- **Semantic colors**: Define a clear mapping for confidence tiers (high/medium/low) and macro categories (protein, carbs, fat)
- **Dark mode**: Plan for dark mode from the start; palette must work in both contexts
- **Typography direction**: Sans-serif family; one typeface for headings (bold, modern), one for body (high readability at small sizes on mobile); numeric-friendly for macro values (tabular figures)
- **Type scale**: Define a constrained modular scale (likely 1.2 ratio) to keep hierarchy tight on small screens

## 3. Native Mobile UX Principles

Fitsy is a native mobile app built with React Native and Expo — not a responsive web app.

- **Thumb-zone design**: Primary actions reachable with one hand; bottom tab bar navigation
- **Native navigation patterns**: Stack navigation for drill-down flows, native modals and bottom sheets for contextual actions, platform-specific back gestures (swipe-back on iOS)
- **Progressive disclosure**: Show macro summary first, expand to full breakdown on tap
- **Haptic feedback**: Use light haptics for confirmations (saving a meal, hitting a macro target), reinforcing interactions without visual noise
- **Speed over chrome**: Prioritize content loading and perceived performance; skeleton screens for async data
- **Platform-specific gestures**: Support native gestures — swipe-to-dismiss, long-press context menus, pull-to-refresh
- **Contextual defaults**: Pre-fill location, remember last macro targets, surface relevant filters based on time of day
- **Offline tolerance**: Graceful degradation when connectivity is poor; cache recent searches and favorites with local storage
- **Minimal input**: Reduce typing — use sliders for macro targets, chips for filters, location auto-detect

## 4. Core Screen Flows

These are native screens managed by Expo Router. Top-level tabs use a bottom tab bar; drill-down flows use stack navigation with native transitions. Contextual actions (filters, portion adjustments) use native modals and bottom sheets.

```mermaid
flowchart TD
    A["Search / Discovery<br/>(Tab — Bottom Tab Bar)<br/>― Set macro targets<br/>― Filter by cuisine, distance<br/>― Browse matched restaurants"]
    B["Restaurant Detail<br/>(Stack Screen)<br/>― View menu items<br/>― See match scores<br/>― Filter by macro fit"]
    C["Meal Detail<br/>(Stack Screen)<br/>― Full macro breakdown<br/>― Confidence tier info<br/>― Adjust portion / Save"]
    D["User Profile / Targets<br/>(Tab — Bottom Tab Bar)<br/>― Set daily P/C/F goals<br/>― Manage preferences<br/>― View saved meals"]

    A -->|"Stack push"| B
    B -->|"Stack push"| C
    A -->|"Tab switch"| D
    B -->|"Tab switch"| D
    C -->|"Tab switch"| D
    C -->|"Stack pop"| B
    B -->|"Stack pop"| A
```

### 4.1 Search and Discovery (Restaurant List)
- User sets macro targets + location → loading state while backend discovers, scrapes, estimates, and ranks
- Results are a **list of restaurants** (not meals), ranked by how well their menu fits the user's targets
- Restaurant cards showing: name, cuisine, distance, # of fitting meals, best-match meal preview (P/C/F)
- Prominent macro-target bar showing current targets at the top
- Quick filters: cuisine type, chain vs. independent, distance radius
- Sort options: distance, number of matches, best single-meal match

### 4.2 Restaurant Detail (Matching Meals)
- Restaurant header: name, cuisine, distance, rating, hours, photos
- **"Get directions" button** — opens in Apple Maps / Google Maps
- Matching meals sorted by how close they are to targets (best fit first)
- Non-matching meals shown below, collapsed
- Each meal row: name, macro summary (P/C/F in grams), calorie total, confidence badge, match score

### 4.3 Meal Detail
- Full macro breakdown: protein, carbs, fat (grams and percentage of target)
- Visual macro ring or bar chart
- Confidence badge with explanation tooltip ("AI-estimated with photo" / "AI-estimated from description")
- **Ingredient breakdown** — the LLM's reasoning: list of estimated ingredients with per-ingredient macros
- "Fits your target" summary — shows how this meal fits into remaining daily macros
- Save / favorite action
- **"Get directions" button**

### 4.4 User Profile and Targets
- Macro target setup: manual input of per-meal protein, carbs, fat goals (grams)
- **Post-MVP**: preset templates (cutting, bulking, maintenance) with height/weight/age/activity calculator
- Dietary preferences and restrictions (vegetarian, gluten-free, etc.)
- Saved restaurants and meals
- Search history
- Account settings and preferences

## 5. Key UI Patterns

### 5.1 Macro Visualization
- **Compact form**: Inline P / C / F pill with gram values — used on cards and list items
- **Expanded form**: Segmented ring chart or horizontal stacked bar — used on meal detail
- **Target comparison**: Overlay or side-by-side showing meal macros vs. user target; green/yellow/red for under/near/over
- **Consistency**: Same visual language for macros everywhere — never switch between representations without clear context change

### 5.2 Confidence Indicators
- Two confidence levels at MVP: medium (LLM estimated with photo), low (LLM estimated without photo). High (verified restaurant data) added post-MVP.
- **Visual treatment**: Icon + color badge; always visible, never hidden
- **Disclosure**: Tapping the badge explains the data source and what the tier means
- **Design constraint**: Never present low-confidence data with the same visual weight as verified data — reduce precision display (e.g., round to nearest 5g for low-confidence)

### 5.3 Filtering and Sorting
- Filter bar: horizontally scrollable chips for active filters
- Filter sheet: full-screen bottom sheet for complex filter combinations
- Active filter count badge on the filter icon
- Macro range sliders with real-time result count update
- "Smart match" default sort that balances proximity, match quality, and confidence

## 6. Information Hierarchy Priorities

Define what users see first, second, third on each surface:

1. **Discovery cards**: Macro match quality > restaurant name > distance > cuisine > confidence
2. **Restaurant detail**: Matched meals (highlighted) > full menu > restaurant info
3. **Meal detail**: Macro breakdown > confidence tier > ingredient detail > portion adjustment
4. **General rule**: Actionable nutrition info is always the primary content; restaurant metadata is secondary context

```mermaid
flowchart TD
    A["Match Score<br/>(primary — largest, boldest element)"]
    B["Restaurant Name"]
    C["Distance / Cuisine"]
    D["Macro Preview — P / C / F grams"]
    E["Confidence Badge<br/>(high · medium · low)"]

    A --> B --> C --> D --> E

    style A fill:#2d7d46,color:#fff,stroke:none
    style B fill:#3a9e5c,color:#fff,stroke:none
    style C fill:#5bb87a,color:#fff,stroke:none
    style D fill:#8fd4a4,color:#000,stroke:none
    style E fill:#c6ecd2,color:#000,stroke:none
```

## 7. Accessibility Considerations

- **Color independence**: Confidence tiers and macro categories must be distinguishable without color (use icons, patterns, labels)
- **Contrast ratios**: WCAG AA minimum (4.5:1 for body text, 3:1 for large text) in both light and dark modes
- **Touch targets**: Minimum 44x44pt tap targets; generous spacing between interactive elements
- **Screen reader support**: Use React Native accessibility props (`accessibilityLabel`, `accessibilityRole`, `accessibilityHint`, `accessibilityState`); macro values announced with units ("32 grams protein"); confidence tiers announced descriptively via `accessibilityLabel`
- **Reduced motion**: Respect `AccessibilityInfo.isReduceMotionEnabled()` (iOS) and equivalent on Android; provide static alternatives for animated charts
- **Text scaling**: Layouts must accommodate Dynamic Type (iOS) and font scale settings (Android) up to 200% without breaking; use `allowFontScaling` and test at large sizes
- **Cognitive load**: Avoid jargon; provide onboarding tooltips for macro and confidence concepts

## 8. Design System Foundation

### 8.1 Spacing and Layout
- 4px base unit; spacing scale: 4, 8, 12, 16, 24, 32, 48, 64
- Layout engine: Flexbox (React Native's default) — no CSS grid
- Screen margins: 16px horizontal padding; use `SafeAreaView` to respect device insets (notch, home indicator)
- Use `Dimensions` API and `useWindowDimensions` hook for responsive sizing across device sizes
- Consistent vertical rhythm tied to the type scale

### 8.2 Component Philosophy
- **React Native primitives**: All components built on `View`, `Text`, `Pressable`, `ScrollView`, `FlatList`, etc. — no HTML elements (`div`, `span`, `button`)
- **Composition over customization**: Small, composable primitives (MacroPill, ConfidenceBadge, FilterChip) assembled into larger patterns
- **State-complete**: Every component designed for all states — loading (skeleton), empty, error, populated, disabled
- **Token-driven**: All visual properties (color, spacing, radius, shadow) reference design tokens via `StyleSheet.create` — not inline raw values
- **Platform adaptation**: Use `Platform.select` or platform-specific file extensions (`.ios.tsx` / `.android.tsx`) where native behavior diverges
- **Documentation**: Each component spec includes: anatomy, variants, states, usage guidelines, do/don't examples

### 8.3 Foundational Components (to spec first)
- MacroPill (compact macro display)
- MacroChart (expanded macro visualization)
- ConfidenceBadge (tier indicator)
- RestaurantCard (discovery list item)
- MealRow (menu list item with inline macros)
- FilterChip / FilterSheet
- TargetBar (current macro target summary)
- MatchScore (visual match quality indicator)

---

## Next Steps

Once this outline is approved:
1. Expand each section into a full design brief with visual references and detailed specifications
2. Create initial component specs for the foundational components listed in 8.3
3. Produce wireframes for the four core screen flows
4. Define the complete design token set (colors, typography, spacing, elevation)
