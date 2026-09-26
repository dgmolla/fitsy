import { waitlistConfirmEmailContent } from "@/lib/lifecycleTemplates";
import { LAUNCH_CITY, LAUNCH_DATE_LABEL } from "@/lib/launch";

describe("waitlistConfirmEmailContent", () => {
  it("links the confirm URL as the CTA and states the launch", () => {
    const { subject, html } = waitlistConfirmEmailContent("https://fitsy.org/waitlist/confirm?w=1&t=2");
    expect(subject).toBe("Confirm your spot on the Fitsy waitlist");
    expect(html).toContain('href="https://fitsy.org/waitlist/confirm?w=1&t=2"');
    expect(html).toContain("Confirm my email");
    expect(html).toContain(`${LAUNCH_CITY} launches ${LAUNCH_DATE_LABEL}`);
    // No footer here: sendMarketingEmail appends the compliance footer.
    expect(html).not.toContain("Unsubscribe");
  });
});
