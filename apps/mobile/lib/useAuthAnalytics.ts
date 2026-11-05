import { useEffect } from 'react';
import { supabase } from './supabase';
import { isReviewEmail } from './reviewAccess';
import {
  identifyAnalyticsUser, resetAnalyticsSession, trackSessionRefreshed, trackSessionRefreshFailed,
} from './analytics';

export function useAuthAnalytics(): void {
  useEffect(() => {
    let priorSessionUserId: string | null = null;
    let revision = 0;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      const current = ++revision;
      // Supabase supplies the persisted session through INITIAL_SESSION on boot.
      // Keep the callback synchronous so it never waits on Supabase's auth lock.
      if (session && !session.user.is_anonymous &&
          ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        const identify = (user: typeof session.user) =>
          identifyAnalyticsUser({ ...user, internalOrTest: isReviewEmail(user.email) });
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
          // Persisted metadata can predate revocation on another device.
          // Keep LA attribution off until Auth confirms the current choice.
          identify({ ...session.user, user_metadata: { ...session.user.user_metadata, fitsy_la_cohort_consent_v1: false } });
          // An explicit JWT avoids acquiring the SDK session lock in this callback.
          void supabase.auth.getUser(session.access_token).then(({ data, error }) => {
            if (current === revision && !error && data.user?.id === session.user.id && !data.user.is_anonymous)
              identify(data.user);
          }).catch(() => { /* Identity remains linked, with LA attribution off. */ });
        } else identify(session.user);
        if (event === 'TOKEN_REFRESHED') trackSessionRefreshed();
        priorSessionUserId = session.user.id;
      } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION' || session?.user.is_anonymous) {
        if (event === 'SIGNED_OUT' && priorSessionUserId) trackSessionRefreshFailed();
        priorSessionUserId = null;
        resetAnalyticsSession();
      }
    });
    return () => { ++revision; sub.subscription.unsubscribe(); };
  }, []);
}
