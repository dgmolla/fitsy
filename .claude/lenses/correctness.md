# Lens: correctness

One concern: **does this diff do what it claims, and does it break anything it touches?**
Read `REVIEW.md` first; its severity, evidence, and output rules apply.

## Look for

- Logic inverted or off-by-one against the stated intent (PR title/body is the claim; the diff is the evidence).
- Broken callers: the diff changes a signature, return shape, or side effect and a caller it did not update depends on the old behavior. Read the callers.
- Error paths: a new failure mode that returns the wrong status code, swallows an error, or leaves state half-written (Prisma multi-record mutations belong in transactions).
- Nullability and empty-set behavior: what happens on zero rows, missing env, first run, unauthenticated user.
- Async hazards: unawaited promises whose failure matters, racing writes, retries without idempotency.
- Data shape drift: API response fields the mobile client reads that the diff renames or removes.

## This repo's known traps (grown from real incidents — add here via harness-audit)

- Auth: every route under `apps/api/app/api/restaurants/**` must enforce entitlement server-side (`requireSubscription`/`optionalSubscription`); the client's `isPro` is UX only.
- Macro data: never present LLM-estimated macros at false precision; confidence tier must survive any reshaping of the response.
- Env: reading `process.env` inline with a silent fallback has burned pipeline runs; new env vars belong in `packages/shared/src/env.ts`.
- OTA: mobile JS changes must not depend on native modules not in the shipped binary (`needs-binary` class).

## Examples from real incidents

- Wire-serialization coercion: `JSON.stringify` silently turns `Infinity`/`NaN`
  into `null`, so the wire diverges from the TS type and clients compute on
  null (`(1 - null) * 100` rendered a bogus "100% fit" pill). Tell: a number
  field assigned a sentinel like Infinity. (#245, #246)
- User-state enumeration holes: routing/gating logic added for
  signed-in-entitled forgot the LAPSED state, stranding win-back users. Tell:
  a new branch on entitlement that does not handle every value of
  {anonymous, free, entitled, lapsed}. (#221)
- Client/server entitlement divergence: purchase updates the client's
  RevenueCat state but nothing syncs the server row, so the API 402s a paying
  user. Tell: a purchase/sign-in path that touches only one side of the
  entitlement pair. (#223, #224, #226)

## Promote to lint

When you make the same finding twice, note it under this heading in your review so it becomes a deterministic check (T6). Current candidates: none.
