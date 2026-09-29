/**
 * @jest-environment node
 */
const store = new Map<string, string>();
const getItem = jest.fn(async (k: string) => store.get(k) ?? null);
const setItem = jest.fn(async (k: string, v: string) => { store.set(k, v); });
const removeItem = jest.fn(async (k: string) => { store.delete(k); });
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: (k: string) => getItem(k), setItem: (k: string, v: string) => setItem(k, v), removeItem: (k: string) => removeItem(k), multiRemove: (k: string[]) => removeItem(k as unknown as string) },
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));

// Fresh module per test so the in-memory mirror starts empty. resetModules
// also re-instantiates the expo-router / supabase mocks, so the handles the
// module actually calls are re-imported here rather than captured once at
// file scope (which would point at stale instances).
async function load() {
  jest.resetModules();
  const g = await import('./teaserGate');
  const { router } = await import('expo-router');
  const { supabase } = await import('./supabase');
  const syncPaywallVerdict = jest.fn();
  g.registerPaywallVerdictSync(syncPaywallVerdict);
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  return {
    ...g,
    push: router.push as jest.Mock,
    replace: router.replace as jest.Mock,
    getSession: supabase.auth.getSession as jest.Mock,
    syncPaywallVerdict,
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
    expect(removeItem).toHaveBeenCalledWith(['@fitsy/previewSampleUsed', '@fitsy/previewTourSeen']);
  });

  it('fails open (unused) when storage cannot be read', async () => {
    getItem.mockRejectedValueOnce(new Error('disk'));
    const g = await load();
    expect(await g.hasUsedPreviewSample()).toBe(false);
  });
});

describe('preview tour flag', () => {
  it('is unseen on a fresh device, seen after mark, unseen again after a fresh onboarding pass', async () => {
    const g = await load();
    expect(await g.hasSeenPreviewTour()).toBe(false);
    g.markPreviewTourSeen();
    expect(await g.hasSeenPreviewTour()).toBe(true);
    g.resetPreviewSample();
    expect(await g.hasSeenPreviewTour()).toBe(false);
  });

  it('shows the refreshed story once to a device that completed the old tour', async () => {
    store.set('@fitsy/previewTourSeen', '1');
    const g = await load();
    expect(await g.hasSeenPreviewTour()).toBe(false);
    g.markPreviewTourSeen();
    await Promise.resolve();
    const restarted = await load();
    expect(await restarted.hasSeenPreviewTour()).toBe(true);
  });

  it('persists the mark', async () => {
    const g = await load();
    g.markPreviewTourSeen();
    await Promise.resolve();
    expect(setItem).toHaveBeenCalledWith('@fitsy/previewTourSeen', '2');
  });

  it('fails closed (seen) when storage cannot be read, so a bad disk never traps the user under the scrim', async () => {
    getItem.mockRejectedValueOnce(new Error('disk'));
    const g = await load();
    expect(await g.hasSeenPreviewTour()).toBe(true);
  });
});

describe('routeToPaywall', () => {
  it('ends a returning preview pass before routing to locked content', async () => {
    const g = await load();
    store.set('@fitsy/onboardingPreviewEntry', '1');
    g.getSession.mockResolvedValueOnce({ data: { session: null } });
    await g.routeToPaywall();
    expect(store.has('@fitsy/onboardingPreviewEntry')).toBe(false);
    expect(g.push).toHaveBeenCalledWith('/welcome/signin');
  });
  it('sends a session-less caller to sign-in, a confirmed first-time account to payment', async () => {
    const g = await load();
    g.getSession.mockResolvedValueOnce({ data: { session: null } });
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/signin');
    g.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
    g.syncPaywallVerdict.mockResolvedValueOnce('never_subscribed');
    await g.routeToPaywall({ replace: true });
    expect(g.replace).toHaveBeenLastCalledWith('/welcome/payment');
  });

  it('sends a signed-in *lapsed* subscriber to the win-back screen, not the free-trial paywall', async () => {
    const g = await load();
    g.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
    g.syncPaywallVerdict.mockResolvedValueOnce('expired');
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/resubscribe');
  });

  it('uses the provider-applied active verdict to leave a newly entitled user in place', async () => {
    const g = await load();
    g.syncPaywallVerdict.mockResolvedValueOnce('active');
    await g.routeToPaywall();
    expect(g.syncPaywallVerdict).toHaveBeenCalledTimes(1);
    expect(g.push).not.toHaveBeenCalled();
  });

  it('holds a signed-in account when the backend cannot verify its history', async () => {
    const g = await load();
    g.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
    g.syncPaywallVerdict.mockRejectedValueOnce(new Error('offline'));
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/subscription-check');
  });

  it('reconciles an unknown row before choosing the lapsed route', async () => {
    const g = await load();
    g.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'u1' } } } });
    g.syncPaywallVerdict.mockResolvedValueOnce('expired');
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/resubscribe');
  });

  it('ignores a lapsed response after the signed-in account changes', async () => {
    const g = await load();
    let finishStatus!: (value: string) => void;
    let statusRequested!: () => void;
    const requested = new Promise<void>(resolve => { statusRequested = resolve; });
    g.syncPaywallVerdict.mockImplementationOnce(() => {
      statusRequested();
      return new Promise(resolve => { finishStatus = resolve; });
    });
    const pending = g.routeToPaywall();
    await requested;
    g.getSession.mockResolvedValue({ data: { session: { user: { id: 'u2' } } } });
    finishStatus('expired');
    await pending;
    expect(g.push).not.toHaveBeenCalled();
    expect(g.replace).not.toHaveBeenCalled();
  });

  it('holds when the session check throws, and releases its in-flight guard', async () => {
    const g = await load();
    g.getSession.mockRejectedValueOnce(new Error('offline'));
    await g.routeToPaywall();
    expect(g.push).toHaveBeenLastCalledWith('/welcome/subscription-check');
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
