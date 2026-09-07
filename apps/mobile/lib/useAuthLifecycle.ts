/**
 * Keeps RevenueCat identity and the entitlement verdict in lockstep with
 * Supabase auth events, and arbitrates between the boot effect and the
 * SIGNED_IN events supabase-js emits (including the one it re-emits while
 * recovering a session on cold start).
 *
 * The listener returns synchronously: supabase-js awaits every callback
 * inside its lock, and a getSession inside one waits on this very callback
 * (see settleAfterSignOut in useEntitlementVerdict.ts). Async work is
 * detached.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { CustomerInfo } from 'react-native-purchases';
import { supabase } from './supabase';
import type { EntitlementVerdict } from './useEntitlementVerdict';
import { fetchCustomerInfo, identifyPurchasesUser, logoutPurchasesUser } from './purchases';

export interface AuthLifecycle {
  /** Boot has started: SIGNED_IN events are noted, not acted on, until finishBoot. */
  beginBoot: () => void;
  /** Boot read the session for this user (undefined = anonymous). */
  markBootUser: (userId: string | undefined) => void;
  /** Boot settled (or failed): run a sign-in that landed meanwhile for a different user. */
  finishBoot: (cancelled: boolean) => void;
}

export function useAuthLifecycle({
  verdict,
  setCustomerInfo,
}: {
  verdict: Pick<EntitlementVerdict, 'entitledRef' | 'resolveAfterSignIn' | 'beginSignOut' | 'settleAfterSignOut'>;
  setCustomerInfo: (info: CustomerInfo | null) => void;
}): AuthLifecycle {
  const { entitledRef, resolveAfterSignIn, beginSignOut, settleAfterSignOut } = verdict;
  // Which user boot (or the last sign-in) resolved, and whether boot is still
  // running: the recovery SIGNED_IN must not start a second identify + sync
  // (boot owns that resolution). A real sign-in during a slow boot is
  // deferred, not dropped.
  const bootUserIdRef = useRef<string | null>(null);
  const bootPendingRef = useRef(true);
  const pendingSignInUserIdRef = useRef<string | null>(null);

  /** Identify with RevenueCat and resolve the verdict for a signed-in user (detached). */
  const signIn = useCallback(
    (userId: string) => {
      void resolveAfterSignIn(async () => {
        const info = await identifyPurchasesUser(userId);
        if (info) setCustomerInfo(info);
        return info;
      }).then(() => {
        // From here a duplicate SIGNED_IN for this user is a no-op.
        bootUserIdRef.current = userId;
      });
    },
    [resolveAfterSignIn, setCustomerInfo],
  );

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        if (bootPendingRef.current) {
          pendingSignInUserIdRef.current = session.user.id;
          return;
        }
        if (session.user.id === bootUserIdRef.current && entitledRef.current !== null) return;
        signIn(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        bootUserIdRef.current = null;
        beginSignOut();
        void (async () => {
          await logoutPurchasesUser();
          setCustomerInfo(await fetchCustomerInfo());
          settleAfterSignOut();
        })();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [setCustomerInfo, entitledRef, signIn, beginSignOut, settleAfterSignOut]);

  const beginBoot = useCallback(() => {
    bootPendingRef.current = true;
  }, []);
  const markBootUser = useCallback((userId: string | undefined) => {
    bootUserIdRef.current = userId ?? null;
  }, []);
  const finishBoot = useCallback(
    (cancelled: boolean) => {
      bootPendingRef.current = false;
      const deferred = pendingSignInUserIdRef.current;
      pendingSignInUserIdRef.current = null;
      if (!cancelled && deferred && deferred !== bootUserIdRef.current) signIn(deferred);
    },
    [signIn],
  );

  // Stable identity: the provider's boot effect depends on this object.
  return useMemo(() => ({ beginBoot, markBootUser, finishBoot }), [beginBoot, markBootUser, finishBoot]);
}
