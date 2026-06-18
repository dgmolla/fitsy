import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Emails allowed to use the app for App Store review WITHOUT a paid
// subscription. Mirrors the server-side `DEMO_REVIEW_EMAILS` allowlist
// (apps/api/lib/subscription.ts) so the client paywall and the API gate agree.
//
// Reviewer-only: there is NO UI entry point for these accounts. App Review
// reaches the sign-in via the documented deep link `fitsy://auth/reviewer`.
// A non-reviewer who found that link could sign in, but would still hit the
// paywall here AND get 402s from the API — the server stays the real boundary.
const REVIEW_EMAILS = new Set<string>(['appreview@fitsy.org']);

export function isReviewEmail(email: string | null | undefined): boolean {
  return !!email && REVIEW_EMAILS.has(email.trim().toLowerCase());
}

/**
 * Whether the signed-in user is an App Review demo account, read from the local
 * Supabase session (no network call). `ready` stays false until the lookup
 * settles so the paywall gate can hold instead of flashing the paywall.
 */
export function useIsReviewer(): { ready: boolean; isReviewer: boolean } {
  const [state, setState] = useState<{ ready: boolean; isReviewer: boolean }>({
    ready: false,
    isReviewer: false,
  });
  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) {
          setState({ ready: true, isReviewer: isReviewEmail(data.session?.user?.email) });
        }
      })
      .catch(() => {
        if (active) setState({ ready: true, isReviewer: false });
      });
    return () => {
      active = false;
    };
  }, []);
  return state;
}
