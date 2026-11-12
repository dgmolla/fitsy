import { useEffect } from 'react';
import { supabase } from './supabase';
import { isReviewEmail } from './reviewAccess';
import {
  identifyAnalyticsUser, resetAnalyticsSession, trackSessionRefreshed, trackSessionRefreshFailed,
} from './analytics';

export function useAuthAnalytics(): void {
  useEffect(() => {
    let priorSessionUserId: string | null = null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase supplies the persisted session through INITIAL_SESSION on boot.
      if (session && !session.user.is_anonymous &&
          ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        identifyAnalyticsUser({ ...session.user, internalOrTest: isReviewEmail(session.user.email) });
        if (event === 'TOKEN_REFRESHED') trackSessionRefreshed();
        priorSessionUserId = session.user.id;
      } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION' || session?.user.is_anonymous) {
        if (event === 'SIGNED_OUT' && priorSessionUserId) trackSessionRefreshFailed();
        priorSessionUserId = null;
        resetAnalyticsSession();
      }
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);
}
