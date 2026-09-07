/**
 * @jest-environment node
 */
import { withinMs } from './async';

describe('withinMs', () => {
  afterEach(() => jest.useRealTimers());

  it('gives up after the cap so a stalled promise cannot hold the caller', async () => {
    jest.useFakeTimers();
    const p = withinMs(new Promise<boolean>(() => {}), 4000);
    jest.advanceTimersByTime(4000);
    expect(await p).toBeNull();
  });

  it('passes a prompt result through and clears its timer', async () => {
    jest.useFakeTimers();
    expect(await withinMs(Promise.resolve(true), 4000)).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });
});
