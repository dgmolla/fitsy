import Purchases, { type CustomerInfo } from 'react-native-purchases';
import { configurePurchases, ensurePurchasesUser, identifyPurchasesUser, logoutPurchasesUser, purchasePackage } from './purchases';

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

it('confirms an already identified native account without another login', async () => {
  const login = jest.spyOn(Purchases, 'logIn');
  jest.spyOn(Purchases, 'getAppUserID').mockResolvedValue('buyer');
  expect(await ensurePurchasesUser('buyer')).toBe(true);
  expect(login).not.toHaveBeenCalled();
});

it.each([
  { nativeUser: 'other', current: true },
  { nativeUser: 'buyer', current: false },
])('blocks checkout when the final account match changes: %j', async ({ nativeUser, current }) => {
  jest.spyOn(Purchases, 'getAppUserID').mockResolvedValue(nativeUser);
  const nativePurchase = jest.spyOn(Purchases, 'purchasePackage').mockImplementation(async () => ({ customerInfo: emptyInfo } as never));
  const result = await purchasePackage({} as never, 'buyer', async () => current);
  expect(result).toEqual({ outcome: 'error', customerInfo: null });
  expect(nativePurchase).not.toHaveBeenCalled();
});

it.each([false, true])('orders logout and the next login after the first login settles (failure=%s)', async failFirst => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  let finishLogin!: () => void;
  const pending = new Promise<void>(resolve => { finishLogin = resolve; });
  let nativeUser: string | null = null;
  const events: string[] = [];
  jest.spyOn(Purchases, 'isAnonymous').mockImplementation(async () => nativeUser === null);
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
  expect(events).toEqual(['start:first', 'end:first', ...(!failFirst ? ['logout'] : []), 'start:next', 'end:next']);
  expect(nativeUser).toBe('next');
});
