/**
 * @jest-environment node
 */
const mockGetSession = jest.fn();
const mockSyncSubscription = jest.fn();

jest.mock('./supabase', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));
jest.mock('./apiClient', () => ({
  syncSubscription: (...args: unknown[]) => mockSyncSubscription(...args),
}));

import { syncServerEntitlement, syncServerEntitlementWithin } from './entitlementSync';

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('syncServerEntitlement', () => {
  it('skips the network call without a session (anonymous teaser must not hit an authed 401)', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await syncServerEntitlement()).toBeNull();
    expect(mockSyncSubscription).not.toHaveBeenCalled();
  });

  it("returns the server's verdict when signed in", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSyncSubscription.mockResolvedValue({ active: true, synced: true });
    expect(await syncServerEntitlement()).toEqual({ active: true });
  });

  it('never throws - a failed sync resolves to null', async () => {
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSyncSubscription.mockRejectedValue(new Error('boom'));
    expect(await syncServerEntitlement()).toBeNull();
  });
});

describe('syncServerEntitlementWithin', () => {
  it('gives up after the cap so a stalled sync cannot hold the post-purchase navigation', async () => {
    jest.useFakeTimers();
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
    mockSyncSubscription.mockReturnValue(new Promise(() => {}));
    const p = syncServerEntitlementWithin(4000);
    await Promise.resolve();
    jest.advanceTimersByTime(4000);
    expect(await p).toBeNull();
    jest.useRealTimers();
  });
});
