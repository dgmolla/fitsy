import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows requests up to the max", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });

    expect(limiter.check("ip1").ok).toBe(true);
    expect(limiter.check("ip1").ok).toBe(true);
    expect(limiter.check("ip1").ok).toBe(true);
  });

  it("blocks the (max+1)th request within the window", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });

    limiter.check("ip1");
    limiter.check("ip1");
    limiter.check("ip1");

    const result = limiter.check("ip1");
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks different keys independently", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });

    limiter.check("ipA");
    limiter.check("ipA");
    expect(limiter.check("ipA").ok).toBe(false);

    // ipB is unaffected
    expect(limiter.check("ipB").ok).toBe(true);
  });

  it("allows requests again after the window expires", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });

    limiter.check("ip1");
    limiter.check("ip1");
    expect(limiter.check("ip1").ok).toBe(false);

    // Advance time past the window
    jest.advanceTimersByTime(61_000);

    expect(limiter.check("ip1").ok).toBe(true);
  });

  it("returns correct remaining count", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 5 });

    const r1 = limiter.check("ip1");
    expect(r1.remaining).toBe(4);

    const r2 = limiter.check("ip1");
    expect(r2.remaining).toBe(3);
  });
});
