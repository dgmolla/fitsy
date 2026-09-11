import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { configurePurchases, identifyPurchasesUser, logoutPurchasesUser } from './purchases';

const emptyInfo = { entitlements: { active: {}, all: {} } } as unknown as CustomerInfo;
const originalDev = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
beforeAll(() => {
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true });
  expect(configurePurchases()).toBe(true);
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  if (originalDev) Object.defineProperty(globalThis, '__DEV__', originalDev);
  else Reflect.deleteProperty(globalThis, '__DEV__');
});

it.each([false, true])('orders logout and the next login after the first login settles (failure=%s)', async failFirst => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  let finishLogin!: () => void;
  const pending = new Promise<void>(resolve => { finishLogin = resolve; });
  let nativeUser: string | null = null;
  const events: string[] = [];
  jest.spyOn(Purchases, 'logIn').mockImplementation(async user => {
    events.push(`start:${user}`);
    if (user === 'first') await pending;
    events.push(`end:${user}`);
    if (user === 'first' && failFirst) throw new Error('Offline');
    nativeUser = user;
    return { customerInfo: emptyInfo, created: false };
  });
  jest.spyOn(Purchases, 'logOut').mockImplementation(async () => {
    nativeUser = null;
    events.push('logout');
    return emptyInfo;
  });
  const first = identifyPurchasesUser('first');
  await Promise.resolve();
  const logout = logoutPurchasesUser();
  const next = identifyPurchasesUser('next');
  await Promise.resolve();
  // Resolve before asserting so a deliberately broken implementation cleans up.
  const whilePending = [...events];
  finishLogin();
  await Promise.all([first, logout, next]);
  expect(whilePending).toEqual(['start:first']);
  expect(events).toEqual(['start:first', 'end:first', 'logout', 'start:next', 'end:next']);
  expect(nativeUser).toBe('next');
});

