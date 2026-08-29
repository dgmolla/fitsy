import { hogql, loadPostHogMetrics } from "./posthogService";

const ENV = { ...process.env };
const mockFetch = jest.fn();

function okResponse(results: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ results }) };
}

beforeEach(() => {
  process.env = { ...ENV, POSTHOG_PERSONAL_API_KEY: "phx_test", POSTHOG_PROJECT_ID: "123" };
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  process.env = ENV;
});

describe("hogql", () => {
  it("throws 'not configured' without credentials and never calls fetch", async () => {
    delete process.env["POSTHOG_PERSONAL_API_KEY"];
    await expect(hogql("select 1")).rejects.toThrow("not configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("posts a HogQLQuery to the project query endpoint with a bearer token", async () => {
    mockFetch.mockResolvedValue(okResponse([[1, 2]]));
    const rows = await hogql("select 1");
    expect(rows).toEqual([[1, 2]]);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://us.posthog.com/api/projects/123/query/");
    expect((init.headers as Record<string, string>)["authorization"]).toBe("Bearer phx_test");
    expect(JSON.parse(init.body as string)).toEqual({
      query: { kind: "HogQLQuery", query: "select 1" },
    });
  });

  it("honors POSTHOG_HOST and returns [] when results are missing", async () => {
    process.env["POSTHOG_HOST"] = "https://eu.posthog.com";
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    expect(await hogql("select 1")).toEqual([]);
    expect((mockFetch.mock.calls[0] as [string])[0]).toMatch(/^https:\/\/eu\.posthog\.com\//);
  });

  it("throws on non-2xx", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(hogql("select 1")).rejects.toThrow("HTTP 429");
  });
});

describe("loadPostHogMetrics", () => {
  it("throws 'not configured' up front without credentials", async () => {
    delete process.env["POSTHOG_PROJECT_ID"];
    await expect(loadPostHogMetrics()).rejects.toThrow("not configured");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("maps the four queries to week-over-week + D7 metrics", async () => {
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const q = (JSON.parse(init.body as string) as { query: { query: string } }).query.query;
      if (q.includes("uniqIf")) return okResponse([[50, 45]]);
      if (q.includes("result_count")) return okResponse([["20", "10"]]);
      if (q.includes("countIf(returned)")) return okResponse([[20, 5]]);
      return okResponse([[200, 150]]);
    });
    const m = await loadPostHogMetrics();
    expect(m).toEqual({
      wau: { thisWeek: 50, lastWeek: 45 },
      searches: { thisWeek: 200, lastWeek: 150 },
      zeroResultSearches: { thisWeek: 20, lastWeek: 10 },
      d7: { cohort: 20, returned: 5 },
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("degrades a single failing query to null instead of dropping the section", async () => {
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const q = (JSON.parse(init.body as string) as { query: { query: string } }).query.query;
      if (q.includes("countIf(returned)")) return { ok: false, status: 500, json: async () => ({}) };
      return okResponse([[1, 1]]);
    });
    const m = await loadPostHogMetrics();
    expect(m.d7).toBeNull();
    expect(m.wau).toEqual({ thisWeek: 1, lastWeek: 1 });
  });

  it("treats empty result sets as zero", async () => {
    mockFetch.mockResolvedValue(okResponse([]));
    const m = await loadPostHogMetrics();
    expect(m.wau).toEqual({ thisWeek: 0, lastWeek: 0 });
    expect(m.d7).toEqual({ cohort: 0, returned: 0 });
  });
});
