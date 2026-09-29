import { useCallback, type MutableRefObject } from 'react';
import type { CustomerInfo } from 'react-native-purchases';
import type { SubscriptionStatusResult, SubscriptionVerdict } from './apiClient';
import type { EntitlementSyncReason } from './entitlement';
import { readCachedEntitlement } from './entitlement';
import { isProActive } from './purchases';
import { withinMs } from './async';
export const BOOT_VERDICT_CAP_MS = 1500;

export function useBootEntitlement({ verdictGenerationRef, customerInfoRef, fetchVerdict, applyVerdict, setEntitled, setClassification, rememberActivePeriod }: {
  verdictGenerationRef: MutableRefObject<number>;
  customerInfoRef: MutableRefObject<CustomerInfo | null>;
  fetchVerdict: (reason: EntitlementSyncReason, userId: string) => Promise<SubscriptionStatusResult | null>;
  applyVerdict: (reason: EntitlementSyncReason, result: SubscriptionStatusResult, userId: string) => boolean | null;
  setEntitled: (next: boolean | null | ((current: boolean | null) => boolean | null)) => void;
  setClassification: (next: SubscriptionVerdict | 'loading') => void;
  rememberActivePeriod: (userId: string, expiresAt: string | null) => void;
}) {
  const resolveAtBoot = useCallback(
    async (userId: string | undefined, rcReady: Promise<CustomerInfo | null>, isCancelled: () => boolean) => {
      const generation = verdictGenerationRef.current;
      const cachedP = userId ? withinMs(readCachedEntitlement(userId), BOOT_VERDICT_CAP_MS) : Promise.resolve(null);
      const answer = userId ? fetchVerdict('boot', userId) : Promise.resolve(null);
      let identitySettled = false;
      const identity = rcReady.then(
        (value) => { identitySettled = true; return value; },
        () => { identitySettled = true; return null; },
      );
      const [info, cached, server] = await Promise.all([
        withinMs(identity, BOOT_VERDICT_CAP_MS),
        cachedP,
        withinMs(answer, BOOT_VERDICT_CAP_MS),
      ]);
      if (isCancelled() || verdictGenerationRef.current !== generation) return;
      if (!userId) {
        // Anonymous: never left on null, and a stale cache must not count.
        setEntitled(false);
        setClassification('never_subscribed');
        return;
      }
      if (server !== null && server.verdict !== 'active' && server.verdict !== 'unknown' && !identitySettled) {
        // A capped identity read is still pending. Do not show first-time
        // payment until it can rule out an active purchase on this device.
        setClassification('unknown');
        setEntitled(null);
        void identity.then(async (late) => {
          if (isCancelled() || verdictGenerationRef.current !== generation) return;
          if (!isProActive(late)) {
            applyVerdict('boot', server, userId);
            return;
          }
          const reconciled = await fetchVerdict('mismatch', userId);
          if (reconciled?.verdict === 'active' && !isCancelled() && verdictGenerationRef.current === generation) {
            applyVerdict('mismatch', reconciled, userId);
          }
        });
        return;
      }
      // Applied only now, after the RevenueCat read, so the mismatch event
      // compares against the real device state.
      let lateEscalation: Promise<SubscriptionStatusResult | null> | null = null;
      if (server !== null && (server.verdict === 'unknown' || (server.verdict !== 'active' && isProActive(info)))) {
        // The stored row says no while the device says Pro: a missed webhook
        // or an earlier lagging sync. The boot read is a cheap DB read, so
        // escalate once to a RevenueCat re-read BEFORE anything settles, so
        // the common case lands on search with no paywall flash. Past the
        // cap, fold as usual and let the late answer apply. Without this a
        // subscriber is locked out until they tap Restore: the mismatch
        // handler lives on the search screen, which never mounts.
        const escalation = fetchVerdict('mismatch', userId);
        const escalatedAnswer = await withinMs(escalation, BOOT_VERDICT_CAP_MS);
        if (isCancelled() || verdictGenerationRef.current !== generation) return;
        if (escalatedAnswer !== null && escalatedAnswer.verdict !== 'unknown') {
          const escalated = applyVerdict('mismatch', escalatedAnswer, userId);
          setEntitled((current) => current ?? escalated);
          return;
        }
        lateEscalation = escalation;
      }
      if (lateEscalation) {
        // Device Pro conflicts with the backend's older negative proof. A
        // capped re-read stays recoverable instead of flashing payment.
        setClassification('unknown');
        setEntitled(null);
        const fallbackGeneration = verdictGenerationRef.current;
        void lateEscalation.then((late) => {
          if (late !== null && !isCancelled() && verdictGenerationRef.current === fallbackGeneration) {
            applyVerdict('mismatch', late, userId);
          }
        });
        return;
      }
      if (server === null && (!cached || (!cached.active && isProActive(info)))) {
        // Without account-bound proof, or when a cached negative conflicts
        // with device Pro, hold recovery until the backend can verify access.
        setClassification('unknown');
        setEntitled(null);
        void answer.then((late) => {
          if (late !== null && !isCancelled() && verdictGenerationRef.current === generation) applyVerdict('boot', late, userId);
        });
        return;
      }
      const effective = server === null ? null : applyVerdict('boot', server, userId);
      if (server?.verdict === 'unknown') {
        // A missing or stale RC proof must never route to the first-time
        // paywall. The late reconciliation below can still settle it.
        setClassification('unknown');
        setEntitled(null);
      } else if (server === null) {
        if (cached?.active) rememberActivePeriod(userId, cached.expiresAt);
        setClassification(cached?.verdict ?? (isProActive(info) ? 'active' : 'unknown'));
      }
      // The server or a fresh account-bound cache settles the gate. Device
      // state only helps detect a mismatch; `current` covers a newer answer.
      if (server?.verdict !== 'unknown') setEntitled((current) => current ?? effective ?? cached?.active ?? isProActive(info));
      if (server === null) {
        // Slow server: apply its answer when it finally lands.
        void answer.then((late) => {
          if (late !== null && !isCancelled() && verdictGenerationRef.current === generation) applyVerdict('boot', late, userId);
        });
      }
    },
    [fetchVerdict, applyVerdict, rememberActivePeriod, setEntitled, setClassification],
  );

  const settleAfterBootFailure = useCallback(
    async (userId: string | undefined, isCancelled: () => boolean) => {
      const cached = userId ? await withinMs(readCachedEntitlement(userId), BOOT_VERDICT_CAP_MS) : null;
      if (isCancelled()) return;
      if (userId && (!cached || (!cached.active && isProActive(customerInfoRef.current)))) {
        setClassification('unknown');
        setEntitled(null);
        return;
      }
      if (userId && cached?.active) rememberActivePeriod(userId, cached.expiresAt);
      setEntitled((current) => current ?? cached?.active ?? (userId ? isProActive(customerInfoRef.current) : false));
      setClassification(userId ? (cached?.verdict ?? (isProActive(customerInfoRef.current) ? 'active' : 'unknown')) : 'never_subscribed');
    },
    [customerInfoRef, rememberActivePeriod, setEntitled, setClassification],
  );

  return { resolveAtBoot, settleAfterBootFailure };
}
