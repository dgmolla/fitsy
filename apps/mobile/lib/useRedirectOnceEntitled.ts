import { useCallback, useEffect, useRef } from 'react';

interface Options {
  /** The provider's server verdict (null while unsettled). */
  entitled: boolean | null;
  /** A purchase / restore on this screen is in flight: it navigates itself, hold off. */
  busy: boolean;
  /** Runs at most once, when `entitled` is true and the screen is not busy. */
  onEntitled: () => void;
}

/**
 * Paywall screens (payment, resubscribe) can be up while the verdict turns
 * true without anything on them being tapped: a late boot or sign-in answer
 * past the cap, or a subscription bought on another device. Nothing else on
 * those screens reacts, so the user would sit on a paywall they have already
 * passed until relaunch. Fires `onEntitled` once; `claim()` lets the screen's
 * own success path take that single redirect first, so `busy` flipping back
 * afterwards cannot fire a second navigation.
 *
 * `onEntitled` is read from a ref at fire time so it need not be memoised.
 */
export function useRedirectOnceEntitled({ entitled, busy, onEntitled }: Options): { claim: () => void } {
  const claimedRef = useRef(false);
  const onEntitledRef = useRef(onEntitled);
  onEntitledRef.current = onEntitled;

  useEffect(() => {
    if (entitled !== true || busy || claimedRef.current) return;
    claimedRef.current = true;
    onEntitledRef.current();
  }, [entitled, busy]);

  const claim = useCallback(() => {
    claimedRef.current = true;
  }, []);
  return { claim };
}
