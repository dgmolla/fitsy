jest.mock("@/lib/launchNotify", () => ({
  notifyLaunch: jest.fn(),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { notifyLaunch } from "@/lib/launchNotify";

const SECRET = "cron-secret";
const LA = { lat: 34.05, lng: -118.24 };

function makeRequest(body: unknown, auth: string | null = `Bearer ${SECRET}`): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["authorization"] = auth;
  return new NextRequest("http://localhost/api/internal/waitlist/notify", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env["CRON_SECRET"] = SECRET;
  (notifyLaunch as jest.Mock).mockResolvedValue({ dryRun: true, matched: 2, wouldNotify: 2, wouldSuppress: 0 });
});

afterEach(() => {
  delete process.env["CRON_SECRET"];
});

describe("POST /api/internal/waitlist/notify", () => {
  it("requires the CRON_SECRET bearer", async () => {
    expect((await POST(makeRequest(LA, null))).status).toBe(401);
    expect((await POST(makeRequest(LA, "Bearer wrong"))).status).toBe(401);
    delete process.env["CRON_SECRET"];
    expect((await POST(makeRequest(LA))).status).toBe(401);
    expect(notifyLaunch).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON and a missing launch center", async () => {
    expect((await POST(makeRequest("{nope"))).status).toBe(400);
    expect((await POST(makeRequest({ lat: 34 }))).status).toBe(400);
    expect(notifyLaunch).not.toHaveBeenCalled();
  });

  it("passes the operator's options through and returns the result", async () => {
    const res = await POST(
      makeRequest({ ...LA, radiusMiles: 25, city: "LA", includeUnlocated: true, dryRun: true }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, dryRun: true, matched: 2, wouldNotify: 2, wouldSuppress: 0 });
    expect(notifyLaunch).toHaveBeenCalledWith({
      ...LA,
      radiusMiles: 25,
      city: "LA",
      includeUnlocated: true,
      dryRun: true,
    });
  });
});
