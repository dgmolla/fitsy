import { GET } from "./route";
import { NextRequest } from "next/server";

const SECRET = "cron-secret";

function makeRequest(auth: string | null = `Bearer ${SECRET}`): NextRequest {
  const headers: Record<string, string> = {};
  if (auth) headers["authorization"] = auth;
  return new NextRequest("http://localhost/api/internal/sentry-test", { headers });
}

beforeEach(() => {
  process.env["CRON_SECRET"] = SECRET;
});

afterEach(() => {
  delete process.env["CRON_SECRET"];
});

describe("GET /api/internal/sentry-test", () => {
  it("requires the CRON_SECRET bearer before throwing", async () => {
    expect((await GET(makeRequest(null))).status).toBe(401);
    expect((await GET(makeRequest("Bearer wrong"))).status).toBe(401);
    delete process.env["CRON_SECRET"];
    expect((await GET(makeRequest())).status).toBe(401);
  });

  it("throws the constant synthetic error once authorized", async () => {
    await expect(GET(makeRequest())).rejects.toThrow("Fitsy Sentry verification");
  });
});
