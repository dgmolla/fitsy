import * as WebBrowser from 'expo-web-browser';
import { trackLegalLinkOpened } from './analytics';

/**
 * Legal / support pages are served by the Next.js API app (apps/api). They
 * live on the same origin the mobile client already talks to, so we derive
 * their URLs from EXPO_PUBLIC_API_URL — the same base lib/api.ts and
 * lib/authClient.ts use. This guarantees the links resolve against whatever
 * deployment is serving the app (prod, preview, or local), and that App
 * Store reviewers reach live pages.
 */
const WEB_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export type LegalLink = 'privacy' | 'terms' | 'support';

const PATHS: Record<LegalLink, string> = {
  privacy: '/privacy',
  terms: '/terms',
  support: '/support',
};

export function legalUrl(link: LegalLink): string {
  return `${WEB_BASE}${PATHS[link]}`;
}

/**
 * Open a legal/support page in an in-app browser (SFSafariViewController on
 * iOS) so the user stays in context. Failures are swallowed — a dead link
 * shouldn't crash the profile screen — but still tracked via analytics.
 */
export async function openLegalLink(link: LegalLink): Promise<void> {
  trackLegalLinkOpened({ link });
  try {
    await WebBrowser.openBrowserAsync(legalUrl(link));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to open ${link} link`, err);
  }
}
