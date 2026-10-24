jest.mock("@/lib/restaurantService", () => ({
  prisma: {
    launchWaitlist: { updateMany: jest.fn(), findUnique: jest.fn() },
  },
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/restaurantService";
import { makeConfirmToken } from "@/lib/waitlistConfirm";

function req(query: string, method = "GET"): NextRequest {
  return new NextRequest(`http://localhost/waitlist/confirm?${query}`, { method });
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
  it("shows an explicit confirmation form without confirming when an email scanner fetches the link", async () => {
    const t = makeConfirmToken("wl1") as string;
    const res = await GET(req(`w=wl1&t=${t}`));
    expect(res.status).toBe(200);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
    const html = await res.text();
    expect(html).toContain(`<form method="POST" action="/waitlist/confirm?w=wl1&amp;t=${t}">`);
    expect(html).toContain('type="submit">Confirm my email</button>');
  });

  it("rejects missing or bad links without touching the row", async () => {
    expect((await GET(req(""))).status).toBe(400);
    expect((await GET(req("w=wl1&t=bad"))).status).toBe(400);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
  });

  it("encodes request data in the form action rather than interpreting it as HTML", async () => {
    const id = 'wl"<&';
    const t = makeConfirmToken(id) as string;
    const res = await GET(req(`w=${encodeURIComponent(id)}&t=${t}`));
    expect(await res.text()).toContain(`action="/waitlist/confirm?w=${encodeURIComponent(id)}&amp;t=${t}"`);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
  });

  it("treats a validly signed link for a deleted row as invalid", async () => {
    (prisma.launchWaitlist.findUnique as jest.Mock).mockResolvedValue(null);
    const t = makeConfirmToken("wl1") as string;
    expect((await GET(req(`w=wl1&t=${t}`))).status).toBe(400);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /waitlist/confirm", () => {
  it.each(["", "w=wl1&t=bad", "w=other&t=" + "a".repeat(64)])("rejects invalid tokens on submission: %s", async (query) => {
    expect((await POST(req(query, "POST"))).status).toBe(400);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
  });

  it("re-verifies the token even if GET previously accepted the link", async () => {
    const t = makeConfirmToken("wl1") as string;
    expect((await GET(req(`w=wl1&t=${t}`))).status).toBe(200);
    delete process.env["UNSUBSCRIBE_SECRET"];
    expect((await POST(req(`w=wl1&t=${t}`, "POST"))).status).toBe(400);
    expect(prisma.launchWaitlist.updateMany).not.toHaveBeenCalled();
  });

  it("confirms the row once and renders the confirmation page", async () => {
    const t = makeConfirmToken("wl1") as string;
    const res = await POST(req(`w=wl1&t=${t}`, "POST"));
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
    const res = await POST(req(`w=wl1&t=${t}`, "POST"));
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
    expect((await POST(req(`w=wl1&t=${t}`, "POST"))).status).toBe(400);
  });
});
