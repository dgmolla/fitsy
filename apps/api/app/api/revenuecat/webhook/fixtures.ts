import { NextRequest } from "next/server";

/** Shared request/event builders for the webhook route tests. */

export const AUTH = "Bearer rc-secret";

export function makeRequest(body: unknown, authHeader?: string | null): NextRequest {
  return new NextRequest("http://localhost/api/revenuecat/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Fixed event time so ordering assertions don't depend on the wall clock. */
export const EVENT_MS = Date.UTC(2026, 8, 6, 12, 0, 0);

export function event(overrides: Record<string, unknown> = {}) {
  return {
    event: {
      type: "INITIAL_PURCHASE",
      app_user_id: "user-1",
      product_id: "fitsy.annual",
      expiration_at_ms: Date.now() + 365 * 24 * 60 * 60 * 1000,
      transaction_id: "txn-1",
      event_timestamp_ms: EVENT_MS,
      ...overrides,
    },
  };
}
