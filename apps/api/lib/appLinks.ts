/**
 * Single source for the primary call-to-action destination used across the
 * web app (stats splash, footer, restaurant pages).
 *
 * Until the App Store listing is live, every CTA sends visitors to the
 * waitlist form on the landing page (POST /api/waitlist/web). At launch, swap
 * this once for the App Store URL and restore the store badge in
 * components/landing/Sections.tsx so every surface updates together.
 */
export const WAITLIST_URL = "/#waitlist";
