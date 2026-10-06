/**
 * @jest-environment node
 */
import { archiveActiveMacroTargets, getDiscoveryMacroTargetSnapshot, getMacroTargetSnapshot, getMacroTargetSource, getMacroTargets, hasSavedMealTargets, saveMacroTargets, saveDiscoveryMacroTargets, clearMacroTargets, MACRO_TARGETS_KEY, SEARCH_MACRO_TARGETS_KEY } from './macroStorage';
import type { StoredMacroTargets } from './macroStorage';

// Mock @react-native-async-storage/async-storage
const store: Record<string, string> = {};
let mockUserId: string | null = null;
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getSession: async () => ({ data: {
    session: mockUserId ? { user: { id: mockUserId } } : null,
  } }) } }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) => Promise.resolve(store[key] ?? null)),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
  },
}));

const AsyncStorage = (
  jest.requireMock('@react-native-async-storage/async-storage') as {
    default: {
      getItem: jest.Mock;
      setItem: jest.Mock;
      removeItem: jest.Mock;
    };
  }
).default;

const SAMPLE: StoredMacroTargets = { protein: '150', carbs: '200', fat: '67', calories: '2003' };

test('archived automatic provenance follows only its account until hydration', async () => {
  mockUserId = 'account-a';
  await saveMacroTargets(SAMPLE, 'complete', 'automatic');
  await archiveActiveMacroTargets(mockUserId);
  expect(await getMacroTargetSource()).toBe('automatic');
  mockUserId = 'account-b';
  expect(await getMacroTargetSource()).toBe('manual');
  mockUserId = null;
  expect(await getMacroTargetSource()).toBe('manual');
  mockUserId = 'account-a';
  await saveMacroTargets(SAMPLE, 'complete', 'manual');
  expect(await getMacroTargetSource()).toBe('manual');
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  // Clear in-memory store
  Object.keys(store).forEach((k) => delete store[k]);
});

it('keeps independent filters private across account switches', async () => {
  const first = { protein: '50', carbs: '', fat: '', calories: '600' };
  const second = { protein: '20', carbs: '', fat: '', calories: '400' };
  mockUserId = 'account-a';
  await saveMacroTargets(first, 'search');
  expect(store[`${SEARCH_MACRO_TARGETS_KEY}:account-a`]).toBeTruthy();
  mockUserId = 'account-b';
  expect(await getDiscoveryMacroTargetSnapshot()).toBeNull();
  await saveMacroTargets(second, 'search');
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(second);
  mockUserId = 'account-a';
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(first);
});

it('removes the deleted account filter while ordinary sign-out retains it', async () => {
  mockUserId = 'account-a';
  const filter = { protein: '50', carbs: '', fat: '', calories: '600' };
  await saveMacroTargets(filter, 'search');
  await archiveActiveMacroTargets('account-a');
  expect(store[`${SEARCH_MACRO_TARGETS_KEY}:account-a`]).toBeTruthy();
  await archiveActiveMacroTargets('account-a', true);
  expect(store[`${SEARCH_MACRO_TARGETS_KEY}:account-a`]).toBeUndefined();
});

it('drops a delayed scoped-filter read after its account changes', async () => {
  mockUserId = 'account-a';
  const filter = { protein: '50', carbs: '', fat: '', calories: '600' };
  await saveMacroTargets(filter, 'search');
  let release!: () => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(async (key: string) => {
    await new Promise<void>(resolve => { release = resolve; });
    return store[key] ?? null;
  });
  const reading = getDiscoveryMacroTargetSnapshot();
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  mockUserId = 'account-b';
  release();
  expect(await reading).toBeNull();
});

it('drops a queued discovery edit when its account changes before the write', async () => {
  mockUserId = 'account-a';
  let releaseFirst!: () => void;
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(async (key: string, value: string) => {
    await new Promise<void>(resolve => { releaseFirst = resolve; });
    store[key] = value;
  });
  const first = saveDiscoveryMacroTargets({ protein: '40', carbs: '', fat: '', calories: '600' }, 'search');
  while (!releaseFirst) await new Promise(resolve => setTimeout(resolve, 0));
  const queued = saveDiscoveryMacroTargets({ protein: '55', carbs: '', fat: '', calories: '700' }, 'search');
  mockUserId = 'account-b';
  releaseFirst();
  await Promise.all([first, queued]);
  expect(store[`${SEARCH_MACRO_TARGETS_KEY}:account-b`]).toBeUndefined();
  mockUserId = 'account-a';
  expect((await getDiscoveryMacroTargetSnapshot())?.targets.protein).toBe('40');
});

it('claims a queued anonymous filter for the account that signs in', async () => {
  let releaseFirst!: () => void;
  (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(async (key: string, value: string) => {
    await new Promise<void>(resolve => { releaseFirst = resolve; });
    store[key] = value;
  });
  const first = saveDiscoveryMacroTargets({ protein: '35', carbs: '', fat: '', calories: '500' }, 'search');
  while (!releaseFirst) await new Promise(resolve => setTimeout(resolve, 0));
  const latest = { protein: '45', carbs: '', fat: '', calories: '600' };
  const queued = saveDiscoveryMacroTargets(latest, 'search');
  mockUserId = 'new-account';
  releaseFirst();
  await Promise.all([first, queued]);
  expect((await getDiscoveryMacroTargetSnapshot())?.targets).toEqual(latest);
  expect(store[SEARCH_MACRO_TARGETS_KEY]).toBeUndefined();
});

it('does not expose a signed-in account complete target to a different account', async () => {
  mockUserId = 'account-a';
  await saveMacroTargets(SAMPLE);
  mockUserId = 'account-b';
  expect(await getMacroTargets()).toBeNull();
  expect(await getDiscoveryMacroTargetSnapshot()).toBeNull();
  mockUserId = 'account-a';
  expect(await getMacroTargets()).toEqual(SAMPLE);
});

describe('getMacroTargets', () => {
  it('returns null when nothing is stored', async () => {
    AsyncStorage.getItem.mockResolvedValueOnce(null);
    const result = await getMacroTargets();
    expect(result).toBeNull();
  });

  it('returns parsed targets after saveMacroTargets', async () => {
    await saveMacroTargets(SAMPLE);
    const result = await getMacroTargets();
    expect(result).toEqual(SAMPLE);
  });

  it('returns null when stored value is invalid JSON', async () => {
    AsyncStorage.getItem.mockResolvedValueOnce('not-json');
    const result = await getMacroTargets();
    expect(result).toBeNull();
  });
});

describe('saveMacroTargets', () => {
  it('writes the targets to AsyncStorage under the correct key', async () => {
    await saveMacroTargets(SAMPLE);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      MACRO_TARGETS_KEY,
      JSON.stringify({ ...SAMPLE, _mode: 'complete', _owner: null, _source: 'manual' }),
    );
  });

  it('overwrites a previously stored value', async () => {
    await saveMacroTargets(SAMPLE);
    const updated: StoredMacroTargets = { protein: '180', carbs: '350', fat: '100', calories: '3020' };
    await saveMacroTargets(updated);
    const result = await getMacroTargets();
    expect(result).toEqual(updated);
  });
});

it('repairs a complete stored mismatch while retaining intentional partial filters', async () => {
  await saveMacroTargets({ protein: '55', carbs: '65', fat: '20', calories: '750' });
  expect(await getMacroTargets()).toEqual({ protein: '55', carbs: '65', fat: '20', calories: '660' });
  await saveMacroTargets({ protein: '', carbs: '', fat: '', calories: '600' });
  expect(await getMacroTargets()).toEqual({ protein: '', carbs: '', fat: '', calories: '600' });
  await saveMacroTargets({ protein: '0', carbs: '0', fat: '0', calories: '600' });
  expect(await getMacroTargets()).toEqual({ protein: '0', carbs: '0', fat: '0', calories: '600' });
});

it('retains four independent positive search constraints alongside a complete target', async () => {
  const filter = { protein: '40', carbs: '60', fat: '20', calories: '600' };
  await saveMacroTargets(SAMPLE);
  await saveMacroTargets(filter, 'search');
  expect(await getMacroTargets()).toEqual(SAMPLE);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: filter, mode: 'search' });
  expect(store[SEARCH_MACRO_TARGETS_KEY]).toBeTruthy();
});

it('explicitly linking a filled discovery filter replaces its search snapshot', async () => {
  await saveMacroTargets(SAMPLE);
  await saveMacroTargets({ protein: '40', carbs: '', fat: '20', calories: '600' }, 'search');
  const linked = { protein: '40', carbs: '65', fat: '20', calories: '600' };
  await saveDiscoveryMacroTargets(linked, 'complete');
  expect(store[SEARCH_MACRO_TARGETS_KEY]).toBeUndefined();
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: linked, mode: 'complete' });
});

it('treats an explicitly cleared discovery filter as saved setup', async () => {
  const empty = { protein: '', carbs: '', fat: '', calories: '' };
  mockUserId = 'account-a';
  await saveMacroTargets(empty, 'search');
  expect(await hasSavedMealTargets()).toBe(true);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: empty, mode: 'search' });
});

it('recognizes a legacy partial search filter as saved for completed-account routing', async () => {
  const partial = { protein: '', carbs: '64', fat: '20', calories: '600' };
  store[MACRO_TARGETS_KEY] = JSON.stringify(partial);
  expect(await getMacroTargets()).toBeNull();
  expect(await hasSavedMealTargets()).toBe(true);
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: partial, mode: 'search' });
  store[MACRO_TARGETS_KEY] = JSON.stringify({ protein: '', carbs: '', fat: '', calories: '' });
  expect(await hasSavedMealTargets()).toBe(false);
});

it('restores a coherent legacy zero-protein target as complete', async () => {
  const zeroProtein = { calories: '440', protein: '0', carbs: '65', fat: '20' };
  store[MACRO_TARGETS_KEY] = JSON.stringify(zeroProtein);
  expect(await getMacroTargetSnapshot()).toEqual({ targets: zeroProtein, mode: 'complete' });
  expect(await getDiscoveryMacroTargetSnapshot()).toEqual({ targets: zeroProtein, mode: 'complete' });
  store[MACRO_TARGETS_KEY] = JSON.stringify({ ...zeroProtein, calories: '450' });
  expect(await getMacroTargetSnapshot()).toBeNull();
  expect((await getDiscoveryMacroTargetSnapshot())?.mode).toBe('search');
});

describe('clearMacroTargets', () => {
  it('results in null from getMacroTargets', async () => {
    await saveMacroTargets(SAMPLE);
    await clearMacroTargets();
    AsyncStorage.getItem.mockResolvedValueOnce(null);
    const result = await getMacroTargets();
    expect(result).toBeNull();
  });

  it('calls removeItem with the correct key', async () => {
    await clearMacroTargets();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(MACRO_TARGETS_KEY);
  });
});
