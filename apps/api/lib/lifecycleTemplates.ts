/**
 * Lifecycle (event-driven) email templates. Kept apart from the weekly
 * editions in emailTemplates.ts. No footer: sendMarketingEmail appends it.
 */
import { brandEmailShell } from "@/lib/emailTemplates";
import { LAUNCH_CITY, LAUNCH_DATE_LABEL } from "@/lib/launch";

/** Step 0 of the waitlist track: confirm the address (double opt-in). */
export function waitlistConfirmEmailContent(confirmUrl: string): { subject: string; html: string } {
  const subject = "Confirm your spot on the Fitsy waitlist";
  const bodyHtml = [
    `<h2 style="margin:0 0 16px;font-family:Georgia,serif;font-size:22px;`,
    `font-weight:400;color:#1B3A26;line-height:1.3;">One tap and you're on the list.</h2>`,
    `<p style="margin:0 0 14px;">Someone (hopefully you) asked to join the Fitsy launch waitlist with this address. `,
    `Confirm below and we'll email you the moment Fitsy opens in your city.</p>`,
    `<p style="margin:0 0 14px;">${LAUNCH_CITY} launches ${LAUNCH_DATE_LABEL}. More cities follow.</p>`,
    `<p style="margin:0;color:#7a8c7e;font-size:13px;">If this wasn't you, ignore this email and nothing else will be sent.</p>`,
  ].join("");
  const html = brandEmailShell({
    preheader: `Confirm your email to hear when Fitsy opens in your city.`,
    bodyHtml,
    ctaText: "Confirm my email",
    ctaUrl: confirmUrl,
  });
  return { subject, html };
}
