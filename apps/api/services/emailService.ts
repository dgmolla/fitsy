// Email delivery via Resend (https://resend.com)
// Requires RESEND_API_KEY env var. If absent, email is silently skipped.

const APP_URL = process.env.APP_URL ?? "https://fitsy.app";

interface ResendEmailPayload {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

async function sendEmail(payload: ResendEmailPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return; // silently skip when key is absent

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[emailService] Resend API error ${res.status}: ${body}`);
  }
}

export async function sendWelcomeEmail(
  to: string,
  name?: string,
): Promise<void> {
  const greeting = name ? `Hi ${name},` : "Hi there,";
  const ctaUrl = `${APP_URL}/setup-macros`;

  await sendEmail({
    from: "Fitsy <hello@fitsy.app>",
    to,
    subject: "Welcome to Fitsy — let's find food that fits",
    html: `
<p>${greeting}</p>
<p>You're in! Fitsy finds restaurants near you with meals that match your protein, carb, and fat targets.</p>
<p><a href="${ctaUrl}" style="background:#16a34a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Set up your macro targets</a></p>
<p style="color:#6b7280;font-size:12px;">This is a transactional email. To stop receiving emails, delete your account.</p>
    `.trim(),
    text: `${greeting}\n\nYou're in! Fitsy finds restaurants near you with meals that match your macros.\n\nSet up your macro targets: ${ctaUrl}\n\nThis is a transactional email. To stop receiving emails, delete your account.`,
  });
}
