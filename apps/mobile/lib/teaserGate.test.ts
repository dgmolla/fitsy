/**
 * @jest-environment node
 */
const store = new Map<string, string>();
const getItem = jest.fn(async (k: string) => store.get(k) ?? null);
const setItem = jest.fn(async (k: string, v: string) => { store.set(k, v); });
const removeItem = jest.fn(async (k: string) => { store.delete(k); });
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: (k: string) => getItem(k), setItem: (k: string, v: string) => setItem(k, v), removeItem: (k: string) => removeItem(k) },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));
jest.mock('./purchases', () => ({
  fetchCustomerInfo: jest.fn(async () => null),
  hasLapsedEntitlement: jest.fn((info: unknown) => info !== null && (info as { lapsed?: boolean }).lapsed === true),
}));

// Fresh module per test so the in-memory mirror starts empty. resetModules
// also re-instantiates the expo-router / supabase mocks, so the handles the
// module actually calls are re-imported here rather than captured once at
// file scope (which would point at stale instances).
async function load() {
  jest.resetModules();
  const g = await import('./teaserGate');
  const { router } = await import('expo-router');
  const { supabase } = await import('./supabase');
  const purchases = await import('./purchases');
  return {
    ...g,
    push: router.push as jest.Mock,
    replace: router.replace as jest.Mock,
    getSession: supabase.auth.getSession as jest.Mock,
    fetchCustomerInfo: purchases.fetchCustomerInfo as jest.Mock,
  };
}

beforeEach(() => {
  store.clear();
  getItem.mockClear(); setItem.mockClear(); removeItem.mockClear();
});

describe('free-look flag', () => {
  it('is unused on a fresh device, used after mark, unused again after reset', async () => {
    const g = await load();
    expect(await g.hasUsedPreviewSample()).toBe(false);
    g.markPreviewSampleUsed();
    expect(await g.hasUsedPreviewSample()).toBe(true);
    g.resetPreviewSample();
    expect(await g.hasUsedPreviewSample()).toBe(false);
  });

  it('reads storage once and serves later reads from memory (no per-tap I/O)', async () => {
    const g = await load();
    await g.hasUsedPreviewSample();
    await g.hasUsedPreviewSample();
    await g.hasUsedPreviewSample();
    expect(getItem).toHaveBeenCalledTimes(1);
  });

  it('persists mark/reset to storage in the background', async () => {
    const g = await load();
    g.markPreviewSampleUsed();
    await Promise.resolve();
    expect(setItem).toHaveBeenCalledWith('@fitsy/previewSampleUsed', '1');
    g.resetPreviewSample();
    await Promise.resolve();
    expect(removeItem).toHaveBeenCalledWith('@fitsy/previewSampleUsed');
  });

  it('fails open (unused) when storage cannot be read', async () => {
    getItem.mockRejectedValueOnce(new Error('disk'));
    const g = await load();
    expect(await g.hasUsedPreviewSample()).toBe(false);
  });
});

describe('routeToPaywall', () => {
  it('sends a session-less caller to sign-in, a signed-in one to payment', async () => {
    const g = await load();
    g.getSession.mockResolvedValueOnce({ data: { session: null } });
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/signin');
    g.getSession.mockResolvedValueOnce({ data: { session: {} } });
    await g.routeToPaywall({ replace: true });
    expect(g.replace).toHaveBeenLastCalledWith('/welcome/payment');
  });

  it('sends a signed-in *lapsed* subscriber to the win-back screen, not the free-trial paywall', async () => {
    const g = await load();
    g.getSession.mockResolvedValueOnce({ data: { session: {} } });
    g.fetchCustomerInfo.mockResolvedValueOnce({ lapsed: true });
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/resubscribe');
  });

  it('treats an unreadable customer record as never-subscribed (paywall)', async () => {
    const g = await load();
    g.getSession.mockResolvedValueOnce({ data: { session: {} } });
    g.fetchCustomerInfo.mockResolvedValueOnce(null);
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/payment');
  });

  it('defaults to sign-in when the session check throws, and releases its in-flight guard', async () => {
    const g = await load();
    g.getSession.mockRejectedValueOnce(new Error('offline'));
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/signin');
    // Guard released: a second call navigates again rather than being swallowed.
    g.getSession.mockResolvedValueOnce({ data: { session: null } });
    await g.routeToPaywall();
    expect(g.push).toHaveBeenCalledTimes(2);
  });

  it('releases the in-flight guard even if navigation throws', async () => {
    const g = await load();
    g.getSession.mockResolvedValue({ data: { session: null } });
    g.push.mockImplementationOnce(() => { throw new Error('nav'); });
    await expect(g.routeToPaywall()).rejects.toThrow('nav');
    await g.routeToPaywall();
    expect(g.push).toHaveBeenCalledTimes(2);
  });
});
