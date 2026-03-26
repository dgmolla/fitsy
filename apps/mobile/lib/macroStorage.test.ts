/**
 * @jest-environment node
 */
import { getMacroTargets, saveMacroTargets, clearMacroTargets, MACRO_TARGETS_KEY } from './macroStorage';
import type { StoredMacroTargets } from './macroStorage';

// Mock @react-native-async-storage/async-storage
const store: Record<string, string> = {};

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

const SAMPLE: StoredMacroTargets = { protein: '150', carbs: '200', fat: '67' };

beforeEach(() => {
  jest.clearAllMocks();
  // Clear in-memory store
  Object.keys(store).forEach((k) => delete store[k]);
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
      JSON.stringify(SAMPLE),
    );
  });

  it('overwrites a previously stored value', async () => {
    await saveMacroTargets(SAMPLE);
    const updated: StoredMacroTargets = { protein: '180', carbs: '350', fat: '100' };
    await saveMacroTargets(updated);
    const result = await getMacroTargets();
    expect(result).toEqual(updated);
  });
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
