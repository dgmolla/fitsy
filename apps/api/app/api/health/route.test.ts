// ─── Mock Prisma ─────────────────────────────────────────────────────────────

const mockQueryRaw = jest.fn();

jest.mock("@prisma/client", () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $queryRaw: mockQueryRaw,
  })),
}));

beforeEach(() => {
  const g = globalThis as unknown as { prisma?: unknown };
  delete g.prisma;
  mockQueryRaw.mockReset();
});

import { GET } from "./route";

// ─── Success ──────────────────────────────────────────────────────────────────

describe("GET /api/health — db connected", () => {
  it("returns 200 with ok status when DB responds", async () => {
    mockQueryRaw.mockResolvedValue([{ "?column?": 1 }]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.db).toBe("connected");
    expect(typeof body.timestamp).toBe("string");
  });

  it("includes a version field", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();
    expect(body).toHaveProperty("version");
  });
});

// ─── DB unreachable ───────────────────────────────────────────────────────────

describe("GET /api/health — db unreachable", () => {
  it("returns 503 when DB query throws", async () => {
    mockQueryRaw.mockRejectedValue(new Error("connection refused"));

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.db).toBe("unreachable");
    expect(body.error).toBe("connection refused");
  });

  it("handles non-Error throws", async () => {
    mockQueryRaw.mockRejectedValue("timeout");

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("timeout");
  });
});
