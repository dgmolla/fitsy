import { MenuSourceResolver } from "./resolver";
import type { MenuSource, MenuSourceResult } from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSource(id: string, result: MenuSourceResult): MenuSource {
  return {
    id,
    lookup: jest.fn().mockResolvedValue(result),
  };
}

function makeFailingSource(id: string): MenuSource {
  return {
    id,
    lookup: jest.fn().mockRejectedValue(new Error("Source error")),
  };
}

const NOT_FOUND = (id: string): MenuSourceResult => ({
  found: false,
  items: [],
  sourceId: id,
});

const FOUND = (id: string): MenuSourceResult => ({
  found: true,
  restaurant: { name: "Test Restaurant" },
  items: [{ name: "Test Item" }],
  sourceId: id,
});

// ─── MenuSourceResolver ───────────────────────────────────────────────────────

describe("MenuSourceResolver", () => {
  it("returns result from first source when it finds the restaurant", async () => {
    const ffn = makeSource("ffn", FOUND("ffn"));
    const ubereats = makeSource("ubereats", FOUND("ubereats"));
    const resolver = new MenuSourceResolver([ffn, ubereats]);

    const result = await resolver.resolve("McDonald's", "LA");
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("ffn");
    expect(ffn.lookup).toHaveBeenCalledWith("McDonald's", "LA", undefined);
    expect(ubereats.lookup).not.toHaveBeenCalled();
  });

  it("falls through to second source when first returns not found", async () => {
    const ffn = makeSource("ffn", NOT_FOUND("ffn"));
    const ubereats = makeSource("ubereats", FOUND("ubereats"));
    const resolver = new MenuSourceResolver([ffn, ubereats]);

    const result = await resolver.resolve("Thai Orchid", "Silver Lake");
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("ubereats");
    expect(ffn.lookup).toHaveBeenCalled();
    expect(ubereats.lookup).toHaveBeenCalled();
  });

  it("returns found: false with sourceId none when all sources fail", async () => {
    const ffn = makeSource("ffn", NOT_FOUND("ffn"));
    const ubereats = makeSource("ubereats", NOT_FOUND("ubereats"));
    const firecrawl = makeSource("firecrawl", NOT_FOUND("firecrawl"));
    const resolver = new MenuSourceResolver([ffn, ubereats, firecrawl]);

    const result = await resolver.resolve("Ghost Restaurant", "Nowhere");
    expect(result.found).toBe(false);
    expect(result.sourceId).toBe("none");
  });

  it("returns found: false with sourceId none for empty sources list", async () => {
    const resolver = new MenuSourceResolver([]);

    const result = await resolver.resolve("Any", "Anywhere");
    expect(result.found).toBe(false);
    expect(result.sourceId).toBe("none");
  });

  it("continues fallback chain when a source throws", async () => {
    const failing = makeFailingSource("ffn");
    const ubereats = makeSource("ubereats", FOUND("ubereats"));
    const resolver = new MenuSourceResolver([failing, ubereats]);

    const result = await resolver.resolve("Thai Orchid", "LA");
    expect(result.found).toBe(true);
    expect(result.sourceId).toBe("ubereats");
  });

  it("returns not found when all sources throw", async () => {
    const resolver = new MenuSourceResolver([
      makeFailingSource("ffn"),
      makeFailingSource("ubereats"),
    ]);

    const result = await resolver.resolve("Test", "LA");
    expect(result.found).toBe(false);
    expect(result.sourceId).toBe("none");
  });

  it("passes name and address to each source", async () => {
    const ffn = makeSource("ffn", NOT_FOUND("ffn"));
    const ubereats = makeSource("ubereats", FOUND("ubereats"));
    const resolver = new MenuSourceResolver([ffn, ubereats]);

    await resolver.resolve("Nobu", "903 N La Cienega Blvd, West Hollywood");
    expect(ffn.lookup).toHaveBeenCalledWith("Nobu", "903 N La Cienega Blvd, West Hollywood", undefined);
    expect(ubereats.lookup).toHaveBeenCalledWith("Nobu", "903 N La Cienega Blvd, West Hollywood", undefined);
  });

  // S-133: Verify per-source attempt tracking
  it("returns attempts array with ok status for successful source", async () => {
    const ffn = makeSource("ffn", FOUND("ffn"));
    const resolver = new MenuSourceResolver([ffn]);

    const result = await resolver.resolve("Test", "LA");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]!.sourceId).toBe("ffn");
    expect(result.attempts[0]!.status).toBe("ok");
    expect(result.attempts[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("returns attempts with not_found then ok on fallback", async () => {
    const ffn = makeSource("ffn", NOT_FOUND("ffn"));
    const ubereats = makeSource("ubereats", FOUND("ubereats"));
    const resolver = new MenuSourceResolver([ffn, ubereats]);

    const result = await resolver.resolve("Test", "LA");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ sourceId: "ffn", status: "not_found" });
    expect(result.attempts[1]).toMatchObject({ sourceId: "ubereats", status: "ok" });
  });

  it("returns attempts with error status when source throws", async () => {
    const failing = makeFailingSource("ffn");
    const ubereats = makeSource("ubereats", FOUND("ubereats"));
    const resolver = new MenuSourceResolver([failing, ubereats]);

    const result = await resolver.resolve("Test", "LA");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ sourceId: "ffn", status: "error", reason: "Source error" });
    expect(result.attempts[1]).toMatchObject({ sourceId: "ubereats", status: "ok" });
  });

  it("returns attempts for all sources when none found", async () => {
    const resolver = new MenuSourceResolver([
      makeSource("ffn", NOT_FOUND("ffn")),
      makeSource("ubereats", NOT_FOUND("ubereats")),
    ]);

    const result = await resolver.resolve("Ghost", "Nowhere");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]).toMatchObject({ sourceId: "ffn", status: "not_found" });
    expect(result.attempts[1]).toMatchObject({ sourceId: "ubereats", status: "not_found" });
  });

  it("returns empty attempts array for empty sources list", async () => {
    const resolver = new MenuSourceResolver([]);
    const result = await resolver.resolve("Any", "Anywhere");
    expect(result.attempts).toHaveLength(0);
  });
});
