# Lens: danger-zone

Second, deeper pass for tier-high paths (auth, subscriptions/webhooks, macro
estimation, external clients, migrations, workflows, deploy config). Runs in
ADDITION to correctness. Read `REVIEW.md` first.

## Look for

- Auth: any path where a request reaches subscriber data without
  `requireSubscription`/`optionalSubscription` enforcing entitlement
  server-side; token checks that trust client-supplied claims; privilege
  widening in webhook handlers.
- Money: RevenueCat webhook state transitions that can grant entitlement from
  an unverified event; idempotency of replayed events.
- Macro integrity: any reshaping that drops the confidence tier or presents
  an LLM estimate at false precision (danger zone: users make health
  decisions on this data).
- External clients: missing rate limiting, retries without idempotency,
  resume-safety of pipeline writes.
- Migrations: locks on large tables, backfill strategies, old-code-on-new-schema
  windows (deploys are not atomic with migrations).
- Workflows/deploy config: widened permissions, new secret exposure to steps
  that also read untrusted text, `pull_request_target` with head checkout.

## Verdict discipline

Refute-first: before confirming, actively try to disprove the finding by
reading the guards that might already handle it. Cite what you checked.

## Examples from real incidents

- Publish-command env omission: `eas update` without `--environment production`
  shipped a keyless bundle twice; the paywall hung on "Plans are still
  loading" in prod. Constrained since: `scripts/deploy/ota.sh` hardcodes the
  flag - flag any OTA publish path that bypasses that script. (#219, incidents 2026-09-01)
- Webhook event-type gaps: the RevenueCat handler ignored TRANSFER events, so
  entitlement silently detached from the paying account. Tell: a webhook
  switch without an explicit default that alerts on unknown types. (#223)
