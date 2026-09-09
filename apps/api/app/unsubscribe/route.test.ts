jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  },
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { makeUnsubscribeToken } from "@/lib/unsubscribe";

const SECRET = "unsub-secret";

function req(query: string, method: "GET" | "POST" = "GET"): NextRequest {
  return new NextRequest(`http://localhost/unsubscribe?${query}`, { method });
}

/** Text of a tagged-template Prisma.Sql as passed to $executeRaw. */
function sqlText(call: unknown[]): string {
  const sql = call[0] as { strings?: string[] } | undefined;
  return (sql?.strings ?? []).join("?");
}

/** Bound parameters of that Prisma.Sql, so tests pin WHICH id is opted out. */
function sqlValues(call: unknown[]): unknown[] {
  return (call[0] as { values?: unknown[] }).values ?? [];
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env["UNSUBSCRIBE_SECRET"] = SECRET;
  (prisma.$executeRaw as jest.Mock).mockResolvedValue(1);
  (prisma.$transaction as jest.Mock).mockResolvedValue([1, 1]);
});

afterEach(() => {
  delete process.env["UNSUBSCRIBE_SECRET"];
});

const userTok = () => makeUnsubscribeToken({ userId: "u1" }) as string;
const wlTok = () => makeUnsubscribeToken({ waitlistId: "wl1" }) as string;

describe("GET /unsubscribe", () => {
  it("rejects missing or bad links without mutating", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("u=u1&t=bad"))).status).toBe(400);
    expect((await GET(req("w=wl1&t=bad"))).status).toBe(400);
    // A user token cannot be replayed as a waitlist token for the same id.
    const cross = makeUnsubscribeToken({ userId: "wl1" }) as string;
    expect((await GET(req(`w=wl1&t=${cross}`))).status).toBe(400);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("renders a confirm form for an account link, preserving u=", async () => {
    const res = await GET(req(`u=u1&t=${userTok()}`));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`action="/unsubscribe?u=u1&t=${userTok()}"`);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("renders a confirm form for a waitlist link, preserving w=", async () => {
    const res = await GET(req(`w=wl1&t=${wlTok()}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`action="/unsubscribe?w=wl1&t=${wlTok()}"`);
  });
});

describe("POST /unsubscribe", () => {
  it("rejects bad links", async () => {
    expect((await POST(req("u=u1&t=nope", "POST"))).status).toBe(400);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("account link: opts the User out and any waitlist row for that account or address, atomically", async () => {
    const res = await POST(req(`u=u1&t=${userTok()}`, "POST"));
    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const calls = (prisma.$executeRaw as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(sqlText(calls[0]!)).toContain('UPDATE "User"');
    expect(sqlValues(calls[0]!)).toEqual(["u1"]);
    expect(sqlText(calls[1]!)).toContain('UPDATE "LaunchWaitlist"');
    expect(sqlText(calls[1]!)).toContain('SELECT lower("email") FROM "User"');
    expect(sqlValues(calls[1]!)).toEqual(["u1", "u1"]);
  });

  it("waitlist link: opts the row out and any account it has since linked, atomically", async () => {
    const res = await POST(req(`w=wl1&t=${wlTok()}`, "POST"));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("unsubscribed");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const calls = (prisma.$executeRaw as jest.Mock).mock.calls;
    expect(calls).toHaveLength(2);
    expect(sqlText(calls[0]!)).toContain('UPDATE "LaunchWaitlist"');
    expect(sqlValues(calls[0]!)).toEqual(["wl1"]);
    expect(sqlText(calls[1]!)).toContain('UPDATE "User"');
    expect(sqlText(calls[1]!)).toContain('SELECT "userId" FROM "LaunchWaitlist"');
    expect(sqlValues(calls[1]!)).toEqual(["wl1"]);
  });
});
