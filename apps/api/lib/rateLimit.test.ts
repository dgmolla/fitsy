import { createRateLimiter } from "./rateLimit";

describe("createRateLimiter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("allows requests up to the max", async () => {
    const limiter = createRateLimiter({ namespace: "test", windowMs: 60_000, max: 3 });

    expect((await limiter.check("ip1")).ok).toBe(true);
    expect((await limiter.check("ip1")).ok).toBe(true);
    expect((await limiter.check("ip1")).ok).toBe(true);
  });

  it("blocks the (max+1)th request within the window", async () => {
    const limiter = createRateLimiter({ namespace: "test", windowMs: 60_000, max: 3 });

    await limiter.check("ip1");
    await limiter.check("ip1");
    await limiter.check("ip1");

    const result = await limiter.check("ip1");
    expect(result.ok).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks different keys independently", async () => {
    const limiter = createRateLimiter({ namespace: "test", windowMs: 60_000, max: 2 });

    await limiter.check("ipA");
    await limiter.check("ipA");
    expect((await limiter.check("ipA")).ok).toBe(false);

    // ipB is unaffected
    expect((await limiter.check("ipB")).ok).toBe(true);
  });

  it("allows requests again after the window expires", async () => {
    const limiter = createRateLimiter({ namespace: "test", windowMs: 60_000, max: 2 });

    await limiter.check("ip1");
    await limiter.check("ip1");
    expect((await limiter.check("ip1")).ok).toBe(false);

    // Advance time past the window
    jest.advanceTimersByTime(61_000);

    expect((await limiter.check("ip1")).ok).toBe(true);
  });

  it("returns correct remaining count", async () => {
    const limiter = createRateLimiter({ namespace: "test", windowMs: 60_000, max: 5 });

    const r1 = await limiter.check("ip1");
    expect(r1.remaining).toBe(4);

    const r2 = await limiter.check("ip1");
    expect(r2.remaining).toBe(3);
  });

  it('bounds identity storage without evicting live quotas and reclaims expired keys', async () => {
    const limiter = createRateLimiter({ namespace: "test", windowMs: 60_000, max: 1, maxKeys: 2 });
    expect((await limiter.check('first')).ok).toBe(true);
    expect((await limiter.check('second')).ok).toBe(true);
    expect((await limiter.check('third')).ok).toBe(false);
    expect((await limiter.check('first')).ok).toBe(false);
    jest.advanceTimersByTime(60_000);
    expect((await limiter.check('third')).ok).toBe(true);
    expect((await limiter.check('first')).ok).toBe(true);
  });
});
