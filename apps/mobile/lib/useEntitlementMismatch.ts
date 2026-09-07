import { useEffect, useRef } from 'react';

/**
 * Delay before each attempt, in ms. Length = maximum attempts per Pro
 * episode. Long enough to outlast a purchase whose RevenueCat REST read lags
 * StoreKit: the webhook typically lands within a few seconds, and the last
 * attempts are what unlock the rows once it has.
 */
export const MISMATCH_DELAYS_MS = [0, 2000, 5000, 10000];

interface Options {
  /** Server verdict held by the provider (null until resolved this launch). */
  entitled: boolean | null;
  /** Device hint (RevenueCat CustomerInfo). */
  isPro: boolean;
  /** The API's verdict on the last search: null until a fetch resolves. */
  locked: boolean | null;
  /** Increments on every completed search fetch, so a refetch that comes back still locked re-arms the next attempt. */
  fetchSeq: number;
  /** Ask the server to re-read RevenueCat; resolves to the verdict now in effect. */
  syncEntitlement: (reason: 'mismatch') => Promise<boolean | null>;
  /** Re-run the current search. */
  refetch: () => void;
}

/**
 * We believe the user is Pro (the server said so, or the device does), but
 * the API served a locked page: the server's Subscription row is stale or
 * missing. Reasons seen in production: a subscription RevenueCat transferred
 * to this account from a deleted one, a webhook delivery that never landed,
 * and plain timing - the first search after a purchase racing the sync.
 *
 * Each time the belief flips on (fresh purchase, restore, sign-in) this
 * starts a new episode: sync once per locked fetch, refetch if the server
 * now says active, and try at most `MISMATCH_DELAYS_MS.length` times before
 * leaving it to pull-to-refresh. If the server says not active there is
 * nothing to refetch for: `entitled` flips to false and the tab layout
 * redirects to the paywall.
 *
 * Bounded attempts matter because the search screen can stay mounted under
 * the paywall (teaser -> pay -> `router.replace` back to the same screen):
 * a single once-per-mount attempt could fire while the paywall is still up,
 * lose the race, and never run again.
 *
 * Keyed on the belief, `locked`, and `fetchSeq` only; `refetch` and
 * `syncEntitlement` are read from refs at fire time so parent re-renders
 * can't cancel a pending attempt.
 */
export function useEntitlementMismatch({
  entitled,
  isPro,
  locked,
  fetchSeq,
  syncEntitlement,
  refetch,
}: Options): void {
  // Not while a resolution is in flight (`entitled === null`, boot or
  // sign-in): the provider's own sync is about to answer, and a 'mismatch'
  // fired here as `isPro` flips would just duplicate it.
  const believedPro = entitled !== null && (entitled || isPro);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const syncRef = useRef(syncEntitlement);
  syncRef.current = syncEntitlement;
  const attemptsRef = useRef(0);
  const wasProRef = useRef(believedPro);

  useEffect(() => {
    if (believedPro && !wasProRef.current) attemptsRef.current = 0;
    wasProRef.current = believedPro;
  }, [believedPro]);

  useEffect(() => {
    if (!believedPro || locked !== true) return;
    const attempt = attemptsRef.current;
    if (attempt >= MISMATCH_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      attemptsRef.current = attempt + 1;
      void syncRef.current('mismatch').then((active) => {
        // false = the server's "not entitled" was STORED (never inside the
        // post-purchase grace window): the layout redirects, nothing to
        // refetch. true = in effect (stored, or a refused downgrade right
        // after a purchase): refetch; if the rows are still locked the
        // fetchSeq bump arms the next attempt. null = couldn't ask; the
        // webhook may still have landed, so a refetch is still worth it.
        if (active === false) return;
        refetchRef.current();
      });
    }, MISMATCH_DELAYS_MS[attempt]);
    return () => clearTimeout(timer);
  }, [believedPro, locked, fetchSeq]);
}
