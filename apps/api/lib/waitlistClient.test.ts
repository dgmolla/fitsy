import { joinWaitlist } from "@/lib/waitlistClient";

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock;
});

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as Response;
}

describe("joinWaitlist", () => {
  it("posts the email and honeypot to /api/waitlist/web and resolves ok on 200", async () => {
    fetchMock.mockResolvedValue(response(200, { ok: true }));
    expect(await joinWaitlist("a@b.com", "")).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/waitlist/web", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.com", website: "" }),
    });
  });

  it("maps 429 to the rate-limit copy", async () => {
    fetchMock.mockResolvedValue(response(429, { error: "Too many requests" }));
    expect(await joinWaitlist("a@b.com", "")).toEqual({
      ok: false,
      error: "Too many attempts. Try again in a few minutes.",
    });
  });

  it("passes the server's error string through on 400", async () => {
    fetchMock.mockResolvedValue(response(400, { error: "Enter a valid email" }));
    expect(await joinWaitlist("nope", "")).toEqual({ ok: false, error: "Enter a valid email" });
  });

  it("falls back to a generic message on an unparseable error body", async () => {
    fetchMock.mockResolvedValue(response(500));
    expect(await joinWaitlist("a@b.com", "")).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
  });

  it("falls back to a generic message when fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    expect(await joinWaitlist("a@b.com", "")).toEqual({
      ok: false,
      error: "Something went wrong. Please try again.",
    });
  });
});
