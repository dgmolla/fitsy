jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  },
}));

jest.mock("@/lib/marketingEmail", () => ({
  sendMarketingEmail: jest.fn(),
  isUndeliverableAddress: jest.requireActual("@/lib/marketingEmail").isUndeliverableAddress,
}));

jest.mock("@/lib/emailTemplates", () => ({
  editionForDate: jest.fn(() => ({ slug: "ed-1", subject: "S", html: "<p>h</p>" })),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { sendMarketingEmail } from "@/lib/marketingEmail";

const SECRET = "cron-secret";

function makeRequest(qs = "", auth: string | null = `Bearer ${SECRET}`): NextRequest {
  const headers: Record<string, string> = {};
  if (auth) headers["authorization"] = auth;
  return new NextRequest(`http://localhost/api/internal/marketing/weekly${qs}`, { headers });
}

/** The audience query is the first $queryRawUnsafe call after the dedup DDL. */
function audienceSql(): string {
  return (prisma.$queryRawUnsafe as jest.Mock).mock.calls[0]![0] as string;
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env["CRON_SECRET"] = SECRET;
  (prisma.$executeRawUnsafe as jest.Mock).mockResolvedValue(0);
  (prisma.$queryRawUnsafe as jest.Mock).mockImplementation(async (sql: string) => {
    if (sql.includes('FROM "User"')) {
      return [
        { id: "u1", email: "real@fitsy.org" },
        { id: "u2", email: "seed@fitsy.test" },
      ];
    }
    if (sql.includes("COUNT(*)")) return [{ count: "0" }];
    return []; // dedup lookup: nothing sent yet
  });
  (sendMarketingEmail as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  delete process.env["CRON_SECRET"];
});

describe("GET /api/internal/marketing/weekly", () => {
  it("requires the CRON_SECRET bearer", async () => {
    expect((await GET(makeRequest("", null))).status).toBe(401);
    expect((await GET(makeRequest("", "Bearer nope"))).status).toBe(401);
  });

  it("audience excludes addresses opted out on a LaunchWaitlist row, not just on the User", async () => {
    await GET(makeRequest("?dryRun=1"));
    const sql = audienceSql();
    expect(sql).toContain('u."emailOptOutAt" IS NULL');
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain('FROM "LaunchWaitlist" w');
    expect(sql).toContain('w."email" = lower(u."email")');
    expect(sql).toContain('w."emailOptOutAt" IS NOT NULL');
  });

  it("dry run reports the deliverable audience without sending", async () => {
    const res = await GET(makeRequest("?dryRun=1"));
    // The reserved-TLD seed account is not counted as eligible.
    expect(await res.json()).toEqual({
      ok: true,
      dryRun: true,
      edition: "ed-1",
      eligible: 1,
      alreadySent: 0,
    });
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });

  it("sends to each eligible user as an account recipient and records the dedup row", async () => {
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual({
      ok: true,
      edition: "ed-1",
      eligible: 1,
      sent: 1,
      skipped: 0,
      failed: 0,
    });
    expect(sendMarketingEmail).toHaveBeenCalledWith({
      userId: "u1",
      to: "real@fitsy.org",
      subject: "S",
      html: "<p>h</p>",
    });
    const inserts = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
      (c) => String(c[0]).includes("INSERT INTO"),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.slice(1)).toEqual(["ed-1", "u1"]);
  });

  it("does not record a dedup row for a failed send, so it is retried next run", async () => {
    (sendMarketingEmail as jest.Mock).mockResolvedValue(false);
    const res = await GET(makeRequest());
    expect(await res.json()).toEqual(expect.objectContaining({ sent: 0, failed: 1 }));
    const inserts = (prisma.$executeRawUnsafe as jest.Mock).mock.calls.filter(
      (c) => String(c[0]).includes("INSERT INTO"),
    );
    expect(inserts).toHaveLength(0);
  });
});
