/**
 * Browser-side client for the public waitlist endpoint. Lives in lib/ so
 * components never call fetch directly (structural test 8).
 */

export type JoinWaitlistResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

/**
 * POST /api/waitlist/web. `website` is the honeypot field: real users never
 * fill it, so it is forwarded verbatim and the server discards bot entries.
 */
export async function joinWaitlist(
  email: string,
  website: string,
): Promise<JoinWaitlistResult> {
  try {
    const res = await fetch("/api/waitlist/web", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, website }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 429) {
      return { ok: false, error: "Too many attempts. Try again in a few minutes." };
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? GENERIC_ERROR };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}
