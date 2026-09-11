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

it('finishes an in-flight login before logout and a subsequent account login', async () => {
  let finishLogin!: () => void;
  const pending = new Promise<void>(resolve => { finishLogin = resolve; });
  let nativeUser: string | null = null;
  const events: string[] = [];
  jest.spyOn(Purchases, 'logIn').mockImplementation(async user => {
    events.push(`start:${user}`);
    if (user === 'first') await pending;
    nativeUser = user;
    events.push(`end:${user}`);
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

it('still logs out after a failed login', async () => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(Purchases, 'logIn').mockRejectedValueOnce(new Error('Offline'));
  const logout = jest.spyOn(Purchases, 'logOut').mockResolvedValueOnce(emptyInfo);
  await Promise.all([identifyPurchasesUser('first'), logoutPurchasesUser()]);
  expect(logout).toHaveBeenCalledTimes(1);
});
