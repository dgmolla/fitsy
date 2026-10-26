/** Real route + SQL acceptance. Only Resend and Slack HTTP are replaced. */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/internal/marketing/weekly/route";
import { prisma } from "@/lib/restaurantService";
import { recordSend } from "@/lib/marketingLedger";

jest.setTimeout(30_000);
const describeWithDb = process.env["POSTGRES_PRISMA_URL"] ? describe : describe.skip;

describeWithDb("weekly marketing failure diagnostics (owned DB)", () => {
  const tag = `weekly-445-${process.pid}-${Date.now()}`;
  const account = `delivered+${tag}-account@resend.dev`;
  const waitlist = `delivered+${tag}-waitlist@resend.dev`;
  const emails = [account, waitlist, `delivered+${tag}-optedout@resend.dev`, `delivered+${tag}-unconfirmed@resend.dev`];
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();
  let owned = false;
  let accepted = false;

  function assertOwned(): void {
    // Environment markers alone cannot authorize this mutating route fixture.
    execFileSync(process.execPath, [resolve(__dirname, "../../../../scripts/verify/local-db.mjs"), "--assert-owned-db"], {
      cwd: resolve(__dirname, "../../../.."), stdio: "pipe", timeout: 60_000,
    });
  }

  async function invoke(query = "", authorization = "Bearer fixture-cron") {
    assertOwned();
    return GET(new NextRequest(`http://localhost/api/internal/marketing/weekly${query}`, {
      headers: { authorization },
    }));
  }

  async function clean(): Promise<void> {
    assertOwned();
    await prisma.$transaction([
      prisma.marketingSend.deleteMany({ where: { email: { in: emails } } }),
      prisma.launchWaitlist.deleteMany({ where: { email: { in: emails } } }),
      prisma.user.deleteMany({ where: { id: { startsWith: tag } } }),
    ]);
  }

  function sends() {
    return fetchMock.mock.calls.filter(([url]) => url === "https://api.resend.com/emails");
  }

  function alert(): string {
    return fetchMock.mock.calls.filter(([url]) => url === "https://slack.com/api/chat.postMessage")
      .map(([, init]) => (JSON.parse(init.body) as { text: string }).text).join("\n");
  }

  beforeAll(() => { assertOwned(); owned = true; });
  beforeEach(async () => {
    await clean();
    Object.assign(process.env, {
      CRON_SECRET: "fixture-cron", RESEND_API_KEY: "fixture-resend",
      UNSUBSCRIBE_SECRET: "fixture-secret", FITSY_POSTAL_ADDRESS: "Fixture postal address",
      FITSY_FROM_EMAIL: "Fitsy <fixture@fitsy.org>", SLACK_BOT_TOKEN: "fixture-slack",
    });
    await prisma.$transaction([
      prisma.user.create({ data: { id: `${tag}-account`, email: account } }),
      prisma.launchWaitlist.createMany({ data: [
        { email: waitlist, confirmedAt: new Date() },
        { email: emails[2]!, confirmedAt: new Date(), emailOptOutAt: new Date() },
        { email: emails[3]! },
      ] }),
    ]);
    accepted = false;
    fetchMock.mockReset();
    global.fetch = fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === "https://slack.com/api/chat.postMessage") return Response.json({ ok: true });
      if (url !== "https://api.resend.com/emails") throw new Error("Unexpected service");
      const body = JSON.parse(init.body as string) as { to: string };
      // Fail the fixture if any non-fixture audience reaches the send boundary.
      expect([account, waitlist]).toContain(body.to);
      return accepted ? Response.json({ id: "fixture-send" }) : Response.json({
        name: "validation_error", message: "The fitsy.org domain is not verified.",
      }, { status: 403 });
    });
  });

  afterEach(async () => {
    try {
      if (owned) await clean();
    } finally {
      process.env = { ...originalEnv };
      global.fetch = originalFetch;
    }
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it("keeps authentication and dry-run requests free of sends and ledger writes", async () => {
    expect((await invoke("", "Bearer incorrect")).status).toBe(401);
    expect(await (await invoke("?dryRun=1")).json()).toMatchObject({ dryRun: true, eligible: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await prisma.marketingSend.count({ where: { email: { in: emails } } })).toBe(0);
  });

  it("reports rejection, then recovers with the same keys and excludes already-sent addresses on replay", async () => {
    expect(await (await invoke()).json()).toMatchObject({ sent: 0, failed: 2, unsent: 0 });
    expect(alert()).toContain("domain_unverified (HTTP 403): 2");
    expect(alert()).not.toContain(account);
    expect(alert()).not.toContain(waitlist);
    expect(await prisma.marketingSend.count({ where: { email: { in: emails } } })).toBe(0);
    const keys = sends().map(([, init]) => init.headers["idempotency-key"]);

    accepted = true;
    fetchMock.mockClear();
    expect(await (await invoke()).json()).toMatchObject({ sent: 2, failed: 0 });
    expect(sends().map(([, init]) => init.headers["idempotency-key"])).toEqual(keys);
    expect(await prisma.marketingSend.count({ where: { email: { in: emails } } })).toBe(2);
    expect(alert()).toBe("");

    fetchMock.mockClear();
    expect(await (await invoke()).json()).toMatchObject({ eligible: 0, sent: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves the cross-campaign frequency cap", async () => {
    await recordSend(account, "lifecycle", "fixture-confirm");
    accepted = true;
    expect(await (await invoke()).json()).toMatchObject({ sent: 1, paced: 1, failed: 0 });
    expect(sends()).toHaveLength(1);
    expect(JSON.parse(sends()[0]![1].body).to).toBe(waitlist);
  });

  it("keeps provider retries idempotent and records each successful address only once", async () => {
    const transport = fetchMock.getMockImplementation()!;
    accepted = true;
    let rateLimited = false;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === "https://api.resend.com/emails" && !rateLimited) {
        rateLimited = true;
        return new Response(null, { status: 429, headers: { "retry-after": "0.001" } });
      }
      return transport(url, init);
    });
    expect(await (await invoke()).json()).toMatchObject({ sent: 2, failed: 0 });
    expect(sends()).toHaveLength(3);
    expect(sends()[0]![1].body).toBe(sends()[1]![1].body);
    expect(sends()[0]![1].headers["idempotency-key"]).toBe(sends()[1]![1].headers["idempotency-key"]);
    expect(await prisma.marketingSend.count({ where: { email: { in: emails } } })).toBe(2);
    expect(alert()).toBe("");
  });

  it("fails closed on missing compliance configuration and keeps sends retryable", async () => {
    delete process.env["FITSY_POSTAL_ADDRESS"];
    expect(await (await invoke()).json()).toMatchObject({ sent: 0, failed: 2 });
    expect(alert()).toContain("missing_postal_address: 2");
    expect(sends()).toHaveLength(0);
    expect(await prisma.marketingSend.count({ where: { email: { in: emails } } })).toBe(0);
  });

  it("rechecks opt-out after audience selection before contacting Resend", async () => {
    const transport = fetchMock.getMockImplementation()!;
    accepted = true;
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === "https://api.resend.com/emails") {
        await prisma.launchWaitlist.update({ where: { email: waitlist }, data: { emailOptOutAt: new Date() } });
      }
      return transport(url, init);
    });
    expect(await (await invoke()).json()).toMatchObject({ sent: 1, failed: 1 });
    expect(sends()).toHaveLength(1);
    expect(alert()).toContain("suppressed: 1");
    expect(await prisma.marketingSend.count({ where: { email: waitlist } })).toBe(0);
  });
});
