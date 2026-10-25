/** Resend transport. Results contain fixed categories, never provider bodies. */
export type ResendFailureReason =
  | "domain_unverified"
  | "provider_rejected"
  | "rate_limited"
  | "timeout"
  | "network_error";

export type ResendSendResult =
  | { ok: true }
  | { ok: false; reason: ResendFailureReason; status?: number };

const TIMEOUT_MS = 8000;
const MAX_RETRY_AFTER_MS = 5000;

/** One bounded 429 retry, retaining the same body and idempotency key. */
export async function sendResendEmail(
  apiKey: string,
  body: string,
  idempotencyKey?: string,
): Promise<ResendSendResult> {
  const first = await postResend(apiKey, body, idempotencyKey);
  if (first.result.ok || first.result.status !== 429) return first.result;
  await new Promise((resolve) => setTimeout(resolve, Math.min(first.retryAfterMs ?? 1000, MAX_RETRY_AFTER_MS)));
  return (await postResend(apiKey, body, idempotencyKey)).result;
}

async function postResend(
  apiKey: string,
  body: string,
  idempotencyKey?: string,
): Promise<{ result: ResendSendResult; retryAfterMs?: number }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      signal: ctrl.signal,
      body,
    });
    if (res.ok) return { result: { ok: true } };

    let reason: ResendFailureReason = res.status === 429 ? "rate_limited" : "provider_rejected";
    if (res.status === 403) {
      // Resend uses validation_error for several different failures. Only
      // its documented domain rejection maps to this actionable category.
      // Unknown/malformed bodies retain the HTTP status without raw text.
      const error = await res.json().catch(() => null) as { name?: unknown; message?: unknown } | null;
      if (error?.name === "validation_error" && typeof error.message === "string" &&
          error.message.includes("domain is not verified")) reason = "domain_unverified";
    }
    const retryAfter = Number(res.headers?.get?.("retry-after"));
    return {
      result: { ok: false, reason, status: res.status },
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}),
    };
  } catch {
    return { result: { ok: false, reason: ctrl.signal.aborted ? "timeout" : "network_error" } };
  } finally {
    clearTimeout(timer);
  }
}
