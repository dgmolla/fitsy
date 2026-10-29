import { clearWidget, saveWidgetLocation, syncWidget } from './widgetSync';
import { saveDiscoveryMacroTargets } from './macroStorage';
import { subscribeWidgetUpdates } from './widgetEvents';

const mockStore: Record<string, string> = {};
const mockConfigure = jest.fn(async (_json: string) => undefined);
const mockClear = jest.fn(async () => undefined);
let mockUser: string | null = 'account-a';
jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, NativeModules: {
  FitsyWidgetBridge: { configure: (...args: [string]) => mockConfigure(...args), clear: () => mockClear() },
} }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockStore[key] ?? null,
  setItemAsync: async (key: string, value: string) => { mockStore[key] = value; },
  deleteItemAsync: async (key: string) => { delete mockStore[key]; },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {
  getItem: async (key: string) => mockStore[key] ?? null,
  setItem: async (key: string, value: string) => { mockStore[key] = value; },
  removeItem: async (key: string) => { delete mockStore[key]; },
} }));
jest.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: {
  getSession: async () => ({ data: { session: mockUser ? { access_token: 'private-app-session',
    refresh_token: 'private-refresh-session', user: { id: mockUser } } : null } }),
} }) }));

const originalFetch = global.fetch;
const capability = 'a'.repeat(64);
const tokenResponse = () => new Response(JSON.stringify({ token: capability, expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString() }));
const targets = { calories: '600', protein: '40', carbs: '60', fat: '20' };
const configuration = () => JSON.parse(mockConfigure.mock.calls.at(-1)![0]) as Record<string, unknown>;
beforeEach(async () => {
  await clearWidget();
  for (const key of Object.keys(mockStore)) delete mockStore[key];
  jest.clearAllMocks(); mockUser = 'account-a';
  global.fetch = jest.fn(async () => tokenResponse()) as typeof fetch;
});
afterEach(() => { global.fetch = originalFetch; });

it('shares only a scoped credential, the saved macro targets and last area', async () => {
  await saveDiscoveryMacroTargets(targets, 'search');
  await saveWidgetLocation(34, -118);
  await syncWidget(true);
  expect(configuration()).toMatchObject({ owner: 'account-a', token: capability, locked: false,
    query: { lat: '34', lng: '-118', ...targets } });
  expect(JSON.stringify(configuration())).not.toMatch(/private-app-session|private-refresh-session/);
  expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/widget\/token$/), expect.objectContaining({
    method: 'POST', headers: { Authorization: 'Bearer private-app-session', 'Content-Type': 'application/json' },
  }));
  await syncWidget(true);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('updates on saved targets and area changes while preserving account ownership', async () => {
  const updated = jest.fn(); const unsubscribe = subscribeWidgetUpdates(updated);
  await saveDiscoveryMacroTargets(targets, 'search');
  await saveWidgetLocation(34, -118);
  expect(updated).toHaveBeenCalled();
  unsubscribe();
  await syncWidget(true);
  mockUser = 'account-b';
  await syncWidget(true);
  expect(configuration()).toMatchObject({ owner: 'account-b', query: {} });
  expect(mockClear).toHaveBeenCalled();
  expect(global.fetch).toHaveBeenCalledTimes(2);
});

it('invalidates an in-flight token issuance on logout and revokes using the app session', async () => {
  let resolve!: (value: Response) => void;
  global.fetch = jest.fn(() => new Promise<Response>(done => { resolve = done; })) as typeof fetch;
  const syncing = syncWidget(true);
  // Wait for the actual external request, rather than a guessed duration.
  for (let i = 0; !resolve && i < 100; i++) await Promise.resolve();
  expect(resolve).toBeDefined();
  await clearWidget(); mockUser = null;
  resolve(tokenResponse()); await syncing;
  expect(mockConfigure).not.toHaveBeenCalled();
  expect(mockStore['fitsy_widget_credential']).toBeUndefined();
  global.fetch = jest.fn(async () => tokenResponse()) as typeof fetch;
  await clearWidget('private-app-session');
  expect(global.fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/widget\/token$/), expect.objectContaining({ method: 'DELETE' }));
});

it('marks non-subscribers locked and renews an expired capability', async () => {
  mockStore['fitsy_widget_credential'] = JSON.stringify({ owner: mockUser, origin: 'http://localhost:3000',
    token: 'old', expiresAt: new Date(Date.now() - 1).toISOString() });
  await syncWidget(false);
  expect(mockClear).toHaveBeenCalled();
  expect(configuration()).toMatchObject({ token: capability, locked: true });
});

it('clears the native widget when no account is signed in', async () => {
  mockUser = null;
  await syncWidget(null);
  expect(mockClear).toHaveBeenCalled();
  expect(mockConfigure).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});

it('works with the React Native AbortSignal surface and bounds a stalled request', async () => {
  const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
  Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true });
  jest.useFakeTimers();
  try {
    global.fetch = jest.fn(() => new Promise<Response>(() => {})) as typeof fetch;
    const stalled = syncWidget(true);
    await jest.advanceTimersByTimeAsync(10_000);
    await stalled;
    expect(mockConfigure).not.toHaveBeenCalled();
    const signal = jest.mocked(global.fetch).mock.calls[0]![1]!.signal;
    expect(signal?.aborted).toBe(true);
    global.fetch = jest.fn(async () => tokenResponse()) as typeof fetch;
    await syncWidget(true);
    expect(configuration()).toMatchObject({ token: capability, locked: false });
  } finally {
    if (original) Object.defineProperty(AbortSignal, 'timeout', original);
    jest.useRealTimers();
  }
});
