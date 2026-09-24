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
import { clearPaywallIntent } from './paywallIntent';
import { withinMs } from './async';
import { BOOT_VERDICT_CAP_MS } from './useEntitlementVerdict';

export interface AuthLifecycle {
  /** Boot has started: SIGNED_IN events are noted, not acted on, until finishBoot. */
  beginBoot: () => void;
  /** Boot read the session for this user (undefined = anonymous). */
  markBootUser: (userId: string | undefined) => void;
  /** A session read that passed the boot cap eventually found a user. */
  resumeLateBootUser: (userId: string) => void;
  /** Boot settled (or failed): run a sign-in that landed meanwhile for a different user. */
  finishBoot: (cancelled: boolean) => void;
  /** Whether boot still owns this auth identity. */
  isBootCurrent: (userId: string | undefined) => boolean;
}

export function useAuthLifecycle({
  verdict,
  setCustomerInfo,
}: {
  verdict: Pick<EntitlementVerdict, 'resolveAfterSignIn' | 'beginSignOut' | 'settleAfterSignOut'>;
  setCustomerInfo: (info: CustomerInfo | null) => void;
}): AuthLifecycle {
  const { resolveAfterSignIn, beginSignOut, settleAfterSignOut } = verdict;
  // Which user boot (or the last sign-in) resolved, and whether boot is still
  // running: the recovery SIGNED_IN must not start a second identify + sync
  // (boot owns that resolution). A real sign-in during a slow boot is
  // deferred, not dropped.
  const bootUserIdRef = useRef<string | null>(null);
  const bootPendingRef = useRef(true);
  const bootInvalidatedRef = useRef(false);
  const pendingSignInUserIdRef = useRef<string | null>(null);

  /** Identify with RevenueCat and resolve the verdict for a signed-in user (detached). */
  const signIn = useCallback(
    (userId: string) => {
      // Claim this account before the detached identity read. Supabase may
      // emit the same SIGNED_IN again while the bounded read is still pending.
      bootUserIdRef.current = userId;
      void resolveAfterSignIn(userId, async () => {
        const info = await identifyPurchasesUser(userId);
        if (info) {
          const { data } = await supabase.auth.getSession();
          if (data.session?.user.id === userId) setCustomerInfo(info);
        }
        return info;
      }).catch(() => undefined);
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
        if (session.user.id === bootUserIdRef.current) return;
        signIn(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        void clearPaywallIntent().catch(() => undefined);
        bootInvalidatedRef.current = true;
        bootUserIdRef.current = null;
        pendingSignInUserIdRef.current = null;
        beginSignOut();
        void (async () => {
          // Native logout stays serialized behind any pending login, but the
          // anonymous gate must settle even if that native work never does.
          await withinMs(logoutPurchasesUser(), BOOT_VERDICT_CAP_MS).catch(() => null);
          settleAfterSignOut();
          const info = await fetchCustomerInfo();
          if (bootUserIdRef.current === null && pendingSignInUserIdRef.current === null) {
            setCustomerInfo(info);
          }
        })();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [setCustomerInfo, signIn, beginSignOut, settleAfterSignOut]);

  const beginBoot = useCallback(() => {
    bootPendingRef.current = true;
    bootInvalidatedRef.current = false;
  }, []);
  const markBootUser = useCallback((userId: string | undefined) => {
    if (!bootInvalidatedRef.current) bootUserIdRef.current = userId ?? null;
  }, []);
  const resumeLateBootUser = useCallback((userId: string) => {
    if (bootPendingRef.current) {
      pendingSignInUserIdRef.current = userId;
    } else if (userId !== bootUserIdRef.current) {
      signIn(userId);
    }
  }, [signIn]);
  const finishBoot = useCallback(
    (cancelled: boolean) => {
      bootPendingRef.current = false;
      const deferred = pendingSignInUserIdRef.current;
      pendingSignInUserIdRef.current = null;
      if (!cancelled && deferred && deferred !== bootUserIdRef.current) signIn(deferred);
    },
    [signIn],
  );
  const isBootCurrent = useCallback((userId: string | undefined) =>
    !bootInvalidatedRef.current && bootUserIdRef.current === (userId ?? null) &&
    (!pendingSignInUserIdRef.current || pendingSignInUserIdRef.current === userId), []);

  // Stable identity: the provider's boot effect depends on this object.
  return useMemo(() => ({ beginBoot, markBootUser, resumeLateBootUser, finishBoot, isBootCurrent }), [beginBoot, markBootUser, resumeLateBootUser, finishBoot, isBootCurrent]);
}
