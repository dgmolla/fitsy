import { NextRequest } from "next/server";

const mockFindMany = jest.fn();
const mockPostSlackMessage = jest.fn();

jest.mock("@/lib/restaurantService", () => ({
  prisma: { feedback: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
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
  mockFindMany.mockReset();
  mockPostSlackMessage.mockReset();
  mockPostSlackMessage.mockResolvedValue(true);
  process.env["CRON_SECRET"] = "test-secret";
});

afterAll(() => {
  delete process.env["CRON_SECRET"];
});

import { GET } from "./route";

function makeRequest(authHeader?: string, query = ""): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest(`http://localhost/api/internal/feedback-digest${query}`, {
    headers,
  });
}

const SAMPLE = [
  {
    userEmail: "alice@example.com",
    message: "love it",
    createdAt: new Date("2026-06-06T14:23:05.000Z"),
  },
];

describe("GET /api/internal/feedback-digest", () => {
  it("rejects requests without bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
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

  it("posts the digest to Slack and returns the count", async () => {
    mockFindMany.mockResolvedValue(SAMPLE);

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, count: 1, posted: true });
    expect(mockPostSlackMessage).toHaveBeenCalledTimes(1);
    expect(mockPostSlackMessage.mock.calls[0]![0]).toContain("alice@example.com");
  });

  it("posts an empty-state digest when there is no feedback", async () => {
    mockFindMany.mockResolvedValue([]);

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(0);
    expect(mockPostSlackMessage.mock.calls[0]![0]).toContain("No new feedback");
  });

  it("dry run returns the text without posting to Slack", async () => {
    mockFindMany.mockResolvedValue(SAMPLE);

    const res = await GET(makeRequest("Bearer test-secret", "?dry=1"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dry).toBe(true);
    expect(body.count).toBe(1);
    expect(body.text).toContain("alice@example.com");
    expect(mockPostSlackMessage).not.toHaveBeenCalled();
  });

  it("queries only the last 24h, newest first", async () => {
    mockFindMany.mockResolvedValue([]);
    await GET(makeRequest("Bearer test-secret"));

    const arg = mockFindMany.mock.calls[0]![0];
    expect(arg.orderBy).toEqual({ createdAt: "desc" });
    expect(arg.where.createdAt.gt).toBeInstanceOf(Date);
  });
});
