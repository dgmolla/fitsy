/**
 * Tests for the locationCache module.
 *
 * Uses jest.isolateModules to reset the module-level memory cache between
 * scenarios — the cache is intentionally process-scoped, so tests would
 * otherwise leak state. SecureStore is mocked at the module level (same
 * pattern as useLocation.test.ts).
 */
jest.mock('expo-secure-store', () => ({
  __esModule: true,
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const SecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

const KEY = 'fitsy_last_known_coords';
const COORDS = { lat: 34.0868, lng: -118.3273 };

beforeEach(() => {
  SecureStore.getItemAsync.mockReset();
  SecureStore.setItemAsync.mockReset();
  SecureStore.setItemAsync.mockResolvedValue(undefined);
});

function loadFreshModule() {
  let mod!: typeof import('./locationCache');
  jest.isolateModules(() => {
    mod = require('./locationCache') as typeof import('./locationCache');
  });
  return mod;
}

describe('locationCache', () => {
  it('round-trips set/get via SecureStore', async () => {
    const { setCachedCoords, getCachedCoords } = loadFreshModule();
    SecureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify(COORDS));

    await setCachedCoords(COORDS);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(KEY, JSON.stringify(COORDS));
    expect(await getCachedCoords()).toEqual(COORDS);
  });

  it('hits memory cache before reading SecureStore', async () => {
    const { setCachedCoords, getCachedCoords } = loadFreshModule();

    await setCachedCoords(COORDS);
    SecureStore.getItemAsync.mockClear();

    expect(await getCachedCoords()).toEqual(COORDS);
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('returns null when SecureStore.getItemAsync rejects', async () => {
    const { getCachedCoords } = loadFreshModule();
    SecureStore.getItemAsync.mockRejectedValueOnce(new Error('keychain unavailable'));

    expect(await getCachedCoords()).toBeNull();
  });

  it('returns null when stored value is malformed JSON', async () => {
    const { getCachedCoords } = loadFreshModule();
    SecureStore.getItemAsync.mockResolvedValueOnce('not-json');

    expect(await getCachedCoords()).toBeNull();
  });

  it('returns null when stored value lacks numeric lat/lng', async () => {
    const { getCachedCoords } = loadFreshModule();
    SecureStore.getItemAsync.mockResolvedValueOnce(JSON.stringify({ lat: 'foo', lng: 1 }));

    expect(await getCachedCoords()).toBeNull();
  });

  it('returns null when no coords stored', async () => {
    const { getCachedCoords } = loadFreshModule();
    SecureStore.getItemAsync.mockResolvedValueOnce(null);

    expect(await getCachedCoords()).toBeNull();
  });

  it('swallows SecureStore.setItemAsync failure but still serves memory cache', async () => {
    const { setCachedCoords, getCachedCoords } = loadFreshModule();
    SecureStore.setItemAsync.mockRejectedValueOnce(new Error('disk full'));

    await expect(setCachedCoords(COORDS)).resolves.toBeUndefined();
    SecureStore.getItemAsync.mockClear();
    expect(await getCachedCoords()).toEqual(COORDS);
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });
});
