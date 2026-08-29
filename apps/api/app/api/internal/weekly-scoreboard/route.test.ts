import { NextRequest } from "next/server";

const mockCount = jest.fn();
const mockPostSlackMessage = jest.fn();
const mockLoadPostHogMetrics = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    user: { count: (...a: unknown[]) => mockCount("user", ...a) },
    subscription: { count: (...a: unknown[]) => mockCount("subscription", ...a) },
    savedItem: { count: (...a: unknown[]) => mockCount("savedItem", ...a) },
    feedback: { count: (...a: unknown[]) => mockCount("feedback", ...a) },
    launchWaitlist: { count: (...a: unknown[]) => mockCount("launchWaitlist", ...a) },
  },
}));

jest.mock("@/services/posthogService", () => ({
  loadPostHogMetrics: (...a: unknown[]) => mockLoadPostHogMetrics(...a),
}));

jest.mock("@fitsy/shared", () => {
  const actual = jest.requireActual("@fitsy/shared");
  return {
    __esModule: true,
    ...actual,
    postSlackMessage: (...args: unknown[]) => mockPostSlackMessage(...args),
  };
});

beforeEach(() => {
  mockCount.mockReset();
  mockCount.mockResolvedValue(0);
  mockPostSlackMessage.mockReset();
  mockPostSlackMessage.mockResolvedValue(true);
  mockLoadPostHogMetrics.mockReset();
  mockLoadPostHogMetrics.mockResolvedValue({
    wau: { thisWeek: 10, lastWeek: 8 },
    searches: { thisWeek: 50, lastWeek: 40 },
    zeroResultSearches: { thisWeek: 5, lastWeek: 4 },
    d7: { cohort: 20, returned: 5 },
  });
  process.env["CRON_SECRET"] = "test-secret";
});

afterAll(() => {
  delete process.env["CRON_SECRET"];
});

import { GET } from "./route";

function makeRequest(authHeader?: string, query = ""): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest(`http://localhost/api/internal/weekly-scoreboard${query}`, {
    headers,
  });
}

describe("GET /api/internal/weekly-scoreboard", () => {
  it("rejects requests without a CRON_SECRET bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong"));
    expect(res.status).toBe(401);
  });

  it("rejects when CRON_SECRET is not set", async () => {
    delete process.env["CRON_SECRET"];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(401);
    process.env["CRON_SECRET"] = "test-secret";
  });

  it("dry run returns the text without posting to Slack", async () => {
    const res = await GET(makeRequest("Bearer test-secret", "?dry=1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dry).toBe(true);
    expect(typeof body.text).toBe("string");
    expect(body.text).toContain("Weekly scoreboard");
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });

  it("posts the scoreboard to Slack on a normal call", async () => {
    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, posted: true });
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1);
    expect(mockPostSlackMessage.mock.calls[0]![0]).toContain("Weekly scoreboard");
  });

  it("shows the configured note and still posts when PostHog is not configured", async () => {
    mockLoadPostHogMetrics.mockRejectedValue(new Error("not configured"));

    const res = await GET(makeRequest("Bearer test-secret", "?dry=1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.posthog).toBeNull();
    expect(body.posthogNote).toBe("set POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID");
    expect(body.text).toContain(
      "PostHog metrics unavailable: set POSTHOG_PERSONAL_API_KEY + POSTHOG_PROJECT_ID",
    );

    const live = await GET(makeRequest("Bearer test-secret"));
    expect(live.status).toBe(200);
    expect((await live.json()).posted).toBe(true);
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1);
  });
});
