import { useEffect } from 'react';
import { supabase } from './supabase';
import {
  identifyAnalyticsUser, resetAnalyticsSession, trackSessionRefreshed, trackSessionRefreshFailed,
} from './analytics';

export function useAuthAnalytics(): void {
  useEffect(() => {
    let priorSessionUserId: string | null = null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase supplies the persisted session through INITIAL_SESSION on boot.
      // Keep the callback synchronous so it never waits on Supabase's auth lock.
      if ((event === 'INITIAL_SESSION' || event === 'SIGNED_IN') && session) {
        identifyAnalyticsUser(session.user);
        priorSessionUserId = session.user.id;
      } else if (event === 'TOKEN_REFRESHED' && session) {
        trackSessionRefreshed();
        priorSessionUserId = session.user.id;
      } else if (event === 'SIGNED_OUT') {
        if (priorSessionUserId) trackSessionRefreshFailed();
        priorSessionUserId = null;
        resetAnalyticsSession();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);
}
