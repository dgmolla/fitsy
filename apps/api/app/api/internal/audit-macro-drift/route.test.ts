import { NextRequest } from "next/server";

const mockQueryRaw = jest.fn();
const mockNotifySlack = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRaw: mockQueryRaw,
  })),
}));

jest.mock("@fitsy/shared", () => ({
  __esModule: true,
  notifySlack: (...args: unknown[]) => mockNotifySlack(...args),
}));

beforeEach(() => {
  const g = globalThis as unknown as { prisma?: unknown };
  delete g.prisma;
  mockQueryRaw.mockReset();
  mockNotifySlack.mockReset();
  process.env["CRON_SECRET"] = "test-secret";
});

afterAll(() => {
  delete process.env["CRON_SECRET"];
});

import { GET } from "./route";

function makeRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return new NextRequest("http://localhost/api/internal/audit-macro-drift", {
    headers,
  });
}

describe("GET /api/internal/audit-macro-drift", () => {
  it("rejects requests without bearer token", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(mockQueryRaw).not.toHaveBeenCalled();
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("rejects requests with wrong bearer token", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("rejects when CRON_SECRET is not set", async () => {
    delete process.env["CRON_SECRET"];
    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(401);
    process.env["CRON_SECRET"] = "test-secret";
  });

  it("returns 200 with ok=true when no drift", async () => {
    mockQueryRaw.mockResolvedValue([{ drift_count: 0n }]);

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, drift_count: 0 });
    expect(mockNotifySlack).not.toHaveBeenCalled();
  });

  it("returns 500 and posts Slack alert when drift > 0", async () => {
    mockQueryRaw.mockResolvedValue([{ drift_count: 42n }]);

    const res = await GET(makeRequest("Bearer test-secret"));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ ok: false, drift_count: 42 });
    expect(mockNotifySlack).toHaveBeenCalledTimes(1);
    const [title, detail, opts] = mockNotifySlack.mock.calls[0]!;
    expect(title).toBe("macro drift detected");
    expect(detail).toContain("42");
    expect(opts).toEqual({ source: "audit" });
  });
});
