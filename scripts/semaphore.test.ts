import { Semaphore } from "./semaphore";

describe("Semaphore", () => {
  it("allows up to max concurrent tasks", async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let maxRunning = 0;

    const task = async () => {
      await sem.acquire();
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      sem.release();
    };

    await Promise.all([task(), task(), task(), task()]);
    expect(maxRunning).toBe(2);
  });

  it("run() acquires and releases automatically", async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];

    await Promise.all([
      sem.run(async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 10));
      }),
      sem.run(async () => {
        order.push(2);
      }),
    ]);

    expect(order).toEqual([1, 2]);
  });

  it("releases on error", async () => {
    const sem = new Semaphore(1);

    try {
      await sem.run(async () => {
        throw new Error("fail");
      });
    } catch { /* expected */ }

    // Should not deadlock — semaphore was released
    const result = await sem.run(async () => "ok");
    expect(result).toBe("ok");
  });

  it("handles concurrency of 1 (mutex)", async () => {
    const sem = new Semaphore(1);
    let running = 0;
    let maxRunning = 0;

    const tasks = Array.from({ length: 5 }, () =>
      sem.run(async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        running--;
      }),
    );

    await Promise.all(tasks);
    expect(maxRunning).toBe(1);
  });
});
