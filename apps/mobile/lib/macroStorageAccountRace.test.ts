/**
 * @jest-environment node
 */
import { archiveActiveMacroTargets, clearActiveMacroTargets, getMacroTargets, saveMacroTargets, MACRO_TARGETS_KEY } from './macroStorage';
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

beforeEach(() => {
  jest.clearAllMocks();
  mockUserId = null;
  // Clear in-memory store
  Object.keys(store).forEach((k) => delete store[k]);
});

it('drops an ordinary complete save paused before its write when another account takes over', async () => {
  mockUserId = 'account-a';
  await saveMacroTargets(SAMPLE);
  let release!: () => void;
  const originalGet = AsyncStorage.getItem.getMockImplementation()!;
  AsyncStorage.getItem.mockImplementationOnce(async (key: string) => {
    await new Promise<void>(resolve => { release = resolve; });
    return originalGet(key);
  });
  const oldSave = saveMacroTargets({ protein: '65', carbs: '70', fat: '20', calories: '720' });
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  mockUserId = 'account-b';
  const cleanup = clearActiveMacroTargets();
  const bTarget = { protein: '25', carbs: '55', fat: '20', calories: '500' };
  const newSave = saveMacroTargets(bTarget);
  release();
  expect(await oldSave).toBe(false);
  await cleanup;
  expect(await newSave).toBe(true);
  expect(await getMacroTargets()).toEqual(bTarget);
  expect(JSON.parse(store[MACRO_TARGETS_KEY])._owner).toBe('account-b');
});

it('serializes an in-flight native write with sign-out archive and cleanup before a new account save', async () => {
  mockUserId = 'account-a';
  let release!: () => void;
  AsyncStorage.setItem.mockImplementationOnce(async (key: string, value: string) => {
    await new Promise<void>(resolve => { release = resolve; });
    store[key] = value;
  });
  const saving = saveMacroTargets(SAMPLE);
  while (!release) await new Promise(resolve => setTimeout(resolve, 0));
  const archiving = archiveActiveMacroTargets('account-a');
  const cleanup = clearActiveMacroTargets();
  mockUserId = 'account-b';
  const bTarget = { protein: '25', carbs: '55', fat: '20', calories: '500' };
  const savingB = saveMacroTargets(bTarget);
  release();
  expect(await saving).toBe(false);
  await Promise.all([archiving, cleanup, savingB]);
  expect(await getMacroTargets()).toEqual(bTarget);
  expect(store[`${MACRO_TARGETS_KEY}:account-a`]).toBeUndefined();
});

it('does not clear a new account target when old-account sign-out cleanup arrives late', async () => {
  mockUserId = 'account-b';
  await saveMacroTargets(SAMPLE);
  await clearActiveMacroTargets('account-a');
  expect(await getMacroTargets()).toEqual(SAMPLE);
});
