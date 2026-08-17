/**
 * Launch-notification push via Expo's push service.
 *
 * Uses the Expo push token already stored on the user (User.pushToken) and the
 * "we'll notify you in the app" permission the user granted - so this channel
 * needs no new data collection or disclosure. Returns false (no send) when there
 * is no token, and on any failure; never throws.
 *
 * Push is the PRIMARY launch channel; email is a fallback for users without a
 * push token.
 */
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const TIMEOUT_MS = 8000;

export async function sendLaunchPush(
  pushToken: string | null | undefined,
  city: string | null,
): Promise<boolean> {
  if (!pushToken) return false;
  const where = city ? `in ${city}` : "in your city";

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(EXPO_PUSH_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        to: pushToken,
        title: "Fitsy is here 🎉",
        body: `We just launched ${where}. Open the app to find meals that fit your macros.`,
        sound: "default",
      }),
    });
    if (!res.ok) return false;
    const json = (await res.json().catch(() => null)) as
      | { data?: { status?: string } }
      | null;
    // Expo returns { data: { status: "ok" | "error" } }.
    return json?.data?.status === "ok";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
