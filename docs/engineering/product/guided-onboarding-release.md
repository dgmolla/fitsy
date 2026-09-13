# Guided onboarding release

Fitsy should demonstrate its value with three real meal picks before asking someone to subscribe.
This release replaces the repeated opening pitch with one welcome, coverage selection, optional target assistance, and an editable per-meal summary.
The guided preview keeps dish names and macros visible and offers one craving search.
Full menus, continued discovery and saving lead to live subscription terms with the selected meal preserved.

Back follows actual navigation history.
Explicit decline resets the hard paywall, and successful purchase or restore continues through optional reminders to the selected dish.
Restarting resumes unfinished setup rather than silently replacing the selected area or targets.
Prices, introductory eligibility and trial duration come from the store; nearby dish totals come from the API.
No remote experiment allocation changes are included.

The mobile diff is larger than the normal size limit because ten obsolete pitch pages are replaced with redirects and the connected onboarding journey is reordered together.
The API prerequisite is reviewed and integrated separately.
The mobile PR uses the documented `override-size` label with this rationale while retaining all other checks, independent reviews, and local iPhone product-flow evidence.
Maestro covers repeatable navigation outcomes; Mobile MCP covers visual quality, purchase intent and recovery states.
