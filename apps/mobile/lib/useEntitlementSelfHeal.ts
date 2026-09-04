import { useEffect, useRef } from 'react';
import { syncServerEntitlement } from './entitlementSync';

/** Delay before each attempt, in ms. Length = maximum attempts per Pro episode. */
export const SELF_HEAL_DELAYS_MS = [0, 2000, 5000];

interface Options {
  /** Device-side entitlement (RevenueCat CustomerInfo). */
  isPro: boolean;
  /** Server's verdict on the last search: null until a fetch resolves. */
  locked: boolean | null;
  /** Increments on every completed search fetch, so a refetch that comes back still locked re-arms the next attempt. */
  fetchSeq: number;
  /** Re-run the current search. */
  refetch: () => void;
}

/**
 * Device says Pro, API says locked: the server's Subscription row is stale or
 * missing. Reasons seen in production: a subscription RevenueCat transferred
 * to this account from a deleted one, a webhook delivery that never landed,
 * and plain timing - the first search after a purchase racing the sync.
 *
 * Each time `isPro` becomes true (fresh purchase, restore, sign-in) this
 * starts a new episode: ask the API to re-read RevenueCat, then refetch. If
 * the refetch is still locked it tries again with backoff, up to
 * `SELF_HEAL_DELAYS_MS.length` times, then leaves it to pull-to-refresh.
 *
 * Bounded retries matter because the search screen can stay mounted under
 * the paywall (teaser -> pay -> `router.replace` back to the same screen):
 * a single once-per-mount attempt could fire while the paywall is still up,
 * lose the race, and never run again.
 *
 * Keyed on [isPro, locked, fetchSeq] only; `refetch` is read from a ref at
 * fire time so parent re-renders can't cancel a pending attempt.
 */
export function useEntitlementSelfHeal({ isPro, locked, fetchSeq, refetch }: Options): void {
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const attemptsRef = useRef(0);
  const wasProRef = useRef(isPro);

  useEffect(() => {
    if (isPro && !wasProRef.current) attemptsRef.current = 0;
    wasProRef.current = isPro;
  }, [isPro]);

  useEffect(() => {
    if (!isPro || locked !== true) return;
    const attempt = attemptsRef.current;
    if (attempt >= SELF_HEAL_DELAYS_MS.length) return;
    const timer = setTimeout(() => {
      attemptsRef.current = attempt + 1;
      void syncServerEntitlement().then((result) => {
        // {active:false} = RevenueCat itself says not entitled: nothing to
        // refetch for. null = couldn't ask; the webhook may still have landed,
        // so a refetch is still worth it.
        if (result && !result.active) return;
        refetchRef.current();
      });
    }, SELF_HEAL_DELAYS_MS[attempt]);
    return () => clearTimeout(timer);
  }, [isPro, locked, fetchSeq]);
}
