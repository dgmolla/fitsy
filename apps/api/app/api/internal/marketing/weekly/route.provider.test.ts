// Exercise the real route, audience, suppression, sender, ledger and Slack
// formatter. Only the external database SDK and HTTP services are replaced.
// tests/db/marketingWeekly.db.test.ts also covers these queries with real rows.
const mockDatabase = {
  $queryRawUnsafe: jest.fn(),
  $queryRaw: jest.fn(),
  marketingSend: { findFirst: jest.fn(), upsert: jest.fn() },
};
jest.mock("@prisma/client", () => ({
  ...jest.requireActual("@prisma/client"),
  PrismaClient: jest.fn(() => mockDatabase),
}));

import { NextRequest } from "next/server";
import { GET } from "./route";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };
const fetchMock = jest.fn();
const recipient = "delivered+fitsy-445@resend.dev";

function request(query = "", auth = "Bearer fixture-cron"): NextRequest {
  return new NextRequest(`http://localhost/api/internal/marketing/weekly${query}`, {
    headers: { authorization: auth },
  });
}

function slackText(): string {
  const call = fetchMock.mock.calls.find(([url]) => url === "https://slack.com/api/chat.postMessage");
  return call ? (JSON.parse(call[1].body) as { text: string }).text : "";
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...originalEnv,
    CRON_SECRET: "fixture-cron",
    RESEND_API_KEY: "fixture-resend-key",
    UNSUBSCRIBE_SECRET: "fixture-unsubscribe-secret",
    FITSY_POSTAL_ADDRESS: "Fixture postal address",
    FITSY_FROM_EMAIL: "Fitsy <fixture@fitsy.org>",
    SLACK_BOT_TOKEN: "fixture-slack-key",
  };
  mockDatabase.$queryRawUnsafe.mockImplementation(async (sql: string) =>
    /^SELECT u\./.test(sql.trimStart()) ? [{ id: "fixture-user", email: recipient }] : [],
  );
  mockDatabase.$queryRaw.mockResolvedValue([]);
  mockDatabase.marketingSend.findFirst.mockResolvedValue(null);
  global.fetch = fetchMock.mockImplementation(async (url: string) => {
    if (url === "https://api.resend.com/emails") {
      return Response.json({
        name: "validation_error",
        message: "The fitsy.org domain is not verified. Please, add and verify your domain on https://resend.com/domains",
      }, { status: 403 });
    }
    if (url === "https://slack.com/api/chat.postMessage") return Response.json({ ok: true });
    throw new Error("Unexpected external service");
  });
});

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

it("reports the actual Resend rejection category and HTTP status without recipient or secret data", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ eligible: 1, sent: 0, failed: 1 });
  expect(mockDatabase.marketingSend.upsert).not.toHaveBeenCalled();
  expect(slackText()).toContain("domain_unverified (HTTP 403): 1");
  expect(slackText()).not.toContain(recipient);
  expect(slackText()).not.toContain("fixture-user");
  expect(slackText()).not.toContain("fixture-resend-key");
  expect(slackText()).not.toContain("fixture-unsubscribe-secret");
  expect(slackText()).not.toContain("Please, add and verify");
});

it("aggregates repeated failures while retaining distinct HTTP failures in one alert", async () => {
  mockDatabase.$queryRawUnsafe.mockImplementation(async (sql: string) => /^SELECT u\./.test(sql.trimStart())
    ? [1, 2, 3].map((id) => ({ id: `fixture-${id}`, email: `delivered+fixture-${id}@resend.dev` })) : []);
  const statuses = [403, 403, 503];
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "https://slack.com/api/chat.postMessage") return Response.json({ ok: true });
    return Response.json({
      name: "validation_error",
      message: "The fitsy.org domain is not verified. <@everyone> private@example.org secret-token",
    }, { status: statuses.shift()! });
  });
  expect(await (await GET(request())).json()).toMatchObject({ sent: 0, failed: 3 });
  expect(slackText()).toContain("domain_unverified (HTTP 403): 2");
  expect(slackText()).toContain("provider_rejected (HTTP 503): 1");
  expect(slackText()).not.toMatch(/everyone|private@example|secret-token/);
  expect(fetchMock.mock.calls.filter(([url]) => url === "https://slack.com/api/chat.postMessage")).toHaveLength(1);
  expect(mockDatabase.marketingSend.upsert).not.toHaveBeenCalled();
});

it.each([
  ["missing configuration", "missing_api_key"],
  ["suppression lookup unavailable", "suppression_unavailable"],
  ["address opted out after audience selection", "suppressed"],
])("reports %s without any provider send", async (_scenario, reason) => {
  if (reason === "missing_api_key") delete process.env["RESEND_API_KEY"];
  if (reason === "suppression_unavailable") mockDatabase.$queryRaw.mockRejectedValue(new Error("private DB error"));
  if (reason === "suppressed") mockDatabase.$queryRaw.mockResolvedValue([{ n: 1 }]);
  expect(await (await GET(request())).json()).toMatchObject({ sent: 0, failed: 1 });
  expect(slackText()).toContain(`${reason}: 1`);
  expect(slackText()).not.toContain("private DB error");
  expect(fetchMock.mock.calls.filter(([url]) => url === "https://api.resend.com/emails")).toHaveLength(0);
  expect(mockDatabase.marketingSend.upsert).not.toHaveBeenCalled();
});

it("records successful sends without reporting a failure", async () => {
  fetchMock.mockImplementation(async () => Response.json({ id: "fixture-send" }));
  expect(await (await GET(request())).json()).toMatchObject({ sent: 1, failed: 0 });
  expect(mockDatabase.marketingSend.upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({ email: recipient, campaign: "weekly" }),
  }));
  expect(slackText()).toBe("");
  const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
  expect(sent.headers["List-Unsubscribe"]).toContain("https://fitsy.org/unsubscribe?u=fixture-user&t=");
  expect(sent.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
});

it("never sends for unauthorized requests or dry runs", async () => {
  expect((await GET(request("", "Bearer incorrect"))).status).toBe(401);
  expect(await (await GET(request("?dryRun=1"))).json()).toMatchObject({ dryRun: true, eligible: 1 });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(mockDatabase.marketingSend.upsert).not.toHaveBeenCalled();
});
