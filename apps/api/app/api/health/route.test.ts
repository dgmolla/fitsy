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
  delete process.env.VERCEL_GIT_COMMIT_SHA;
});

import { dynamic, GET, revalidate } from "./route";

describe("health route caching", () => {
  it("is dynamic and disables revalidation", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });
});

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

  it("returns the validated deployment identity and disables caching", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    mockQueryRaw.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(body.deploymentSha).toBe(process.env.VERCEL_GIT_COMMIT_SHA);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["", "0123456789abcdef", "0123456789abcdef0123456789abcdef0123456g"])(
    "omits an invalid deployment identity (%s)",
    async (sha) => {
      process.env.VERCEL_GIT_COMMIT_SHA = sha;
      mockQueryRaw.mockResolvedValue([]);

      const res = await GET();
      const body = await res.json();

      expect(body.deploymentSha).toBeNull();
      expect(res.headers.get("cache-control")).toContain("no-store");
    },
  );

  it("returns null when the deployment identity is absent", async () => {
    mockQueryRaw.mockResolvedValue([]);

    const res = await GET();
    const body = await res.json();

    expect(body.deploymentSha).toBeNull();
    expect(res.headers.get("cache-control")).toContain("no-store");
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
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    mockQueryRaw.mockRejectedValue(new Error("connection refused"));

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.db).toBe("unreachable");
    expect(body.error).toBe("connection refused");
    expect(body.deploymentSha).toBe(process.env.VERCEL_GIT_COMMIT_SHA);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("handles non-Error throws", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "invalid";
    mockQueryRaw.mockRejectedValue("timeout");

    const res = await GET();

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("timeout");
    expect(body.deploymentSha).toBeNull();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});
