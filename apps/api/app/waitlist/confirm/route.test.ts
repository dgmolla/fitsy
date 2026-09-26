jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    launchWaitlist: { updateMany: jest.fn(), findUnique: jest.fn() },
  },
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { makeConfirmToken } from "@/lib/waitlistConfirm";

function req(query: string): NextRequest {
  return new NextRequest(`http://localhost/waitlist/confirm?${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env["UNSUBSCRIBE_SECRET"] = "secret";
  (prisma.launchWaitlist.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
  (prisma.launchWaitlist.findUnique as jest.Mock).mockResolvedValue({ id: "wl1" });
});
afterEach(() => {
  delete process.env["UNSUBSCRIBE_SECRET"];
});

describe("GET /waitlist/confirm", () => {
  it("rejects missing or bad links without touching the row", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("w=wl1&t=bad"))).status).toBe(400);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
  });

  it("confirms the row once and renders the confirmation page", async () => {
    const t = makeConfirmToken("wl1") as string;
    const res = await GET(req(`w=wl1&t=${t}`));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You're confirmed");
    expect(prisma.launchWaitlist.updateMany).toHaveBeenCalledWith({
      where: { id: "wl1", confirmedAt: null },
      data: { confirmedAt: expect.any(Date) },
    });
  });

  it("is idempotent: a second click keeps the first confirmation time and still succeeds", async () => {
    (prisma.launchWaitlist.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const t = makeConfirmToken("wl1") as string;
    const res = await GET(req(`w=wl1&t=${t}`));
    expect(res.status).toBe(200);
    expect(prisma.launchWaitlist.findUnique).toHaveBeenCalledWith({
      where: { id: "wl1" },
      select: { id: true },
    });
  });

  it("treats a validly signed link for a deleted row as invalid", async () => {
    (prisma.launchWaitlist.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.launchWaitlist.findUnique as jest.Mock).mockResolvedValue(null);
    const t = makeConfirmToken("wl1") as string;
    expect((await GET(req(`w=wl1&t=${t}`))).status).toBe(400);
  });
});
