import { sendResendEmail } from "./resendService";

const fetchMock = jest.fn();
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it("recognizes the documented domain rejection and discards its entire body", async () => {
  fetchMock.mockResolvedValue(Response.json({
    name: "validation_error",
    message: "The fitsy.org domain is not verified. Private sender and recipient details.",
    recipient: "private@example.org",
  }, { status: 403 }));
  expect(await sendResendEmail("fixture-key", "{}"))
    .toEqual({ ok: false, reason: "domain_unverified", status: 403 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  [403, { name: "validation_error", message: "Different validation failure with private details" }],
  [403, { name: "unknown", message: "The fitsy.org domain is not verified." }],
  [403, null],
  [403, { message: { private: "not a string" } }],
  [401, { name: "validation_error", message: "The fitsy.org domain is not verified." }],
  [500, { name: "application_error", message: "private body" }],
])("retains HTTP %s without guessing the reason from unknown bodies", async (status, body) => {
  fetchMock.mockResolvedValue(Response.json(body, { status }));
  expect(await sendResendEmail("fixture-key", "{}"))
    .toEqual({ ok: false, reason: "provider_rejected", status });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("keeps a known HTTP rejection when the provider sends a non-JSON error page", async () => {
  fetchMock.mockResolvedValue(new Response("<html>private provider page</html>", { status: 403 }));
  expect(await sendResendEmail("fixture-key", "{}"))
    .toEqual({ ok: false, reason: "provider_rejected", status: 403 });
});

it("reports the final retry failure and retains the same idempotency key and body", async () => {
  jest.useFakeTimers();
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 429, headers: { "retry-after": "1" } }))
    .mockResolvedValueOnce(Response.json({
      name: "validation_error", message: "The fitsy.org domain is not verified.",
    }, { status: 403 }));
  const pending = sendResendEmail("fixture-key", "fixture-body", "fixture-idempotency-key");
  await jest.advanceTimersByTimeAsync(1000);
  expect(await pending).toEqual({ ok: false, reason: "domain_unverified", status: 403 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  for (const [, init] of fetchMock.mock.calls) {
    expect(init.body).toBe("fixture-body");
    expect(init.headers["idempotency-key"]).toBe("fixture-idempotency-key");
  }
});

it("reports exhausted rate limiting without adding more retries", async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(async () => new Response(null, { status: 429 }));
  const pending = sendResendEmail("fixture-key", "{}");
  await jest.advanceTimersByTimeAsync(1000);
  expect(await pending).toEqual({ ok: false, reason: "rate_limited", status: 429 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("distinguishes timeout from network failure without exposing exception text", async () => {
  fetchMock.mockRejectedValueOnce(new Error("private credentials in transport error"));
  expect(await sendResendEmail("fixture-key", "{}"))
    .toEqual({ ok: false, reason: "network_error" });

  jest.useFakeTimers();
  fetchMock.mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new Error("private abort details")), { once: true });
  }));
  const pending = sendResendEmail("fixture-key", "{}");
  await jest.advanceTimersByTimeAsync(8000);
  expect(await pending).toEqual({ ok: false, reason: "timeout" });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(jest.getTimerCount()).toBe(0);
});
