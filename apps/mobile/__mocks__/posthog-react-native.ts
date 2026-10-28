/** External SDK boundary for Node-only library tests; no native survey imports. */
export default class PostHog {
  capture = jest.fn();
  reset = jest.fn();
  flush = jest.fn(async () => {});
}
