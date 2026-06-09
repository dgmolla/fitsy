/**
 * Jest mock for `react-native-purchases`.
 *
 * The real package binds to native modules at import time, which the ts-jest
 * "lib" project (node env) can't load. This mock exports the value-level
 * surface our code touches (the default `Purchases` object + `LOG_LEVEL` enum).
 * Type-only imports (CustomerInfo, PurchasesOfferings) are erased at compile
 * time, so they don't need to appear here. Tests that need specific behaviour
 * override these with `jest.spyOn` / `jest.mock`.
 */
export enum LOG_LEVEL {
  VERBOSE = 'VERBOSE',
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

const emptyCustomerInfo = { entitlements: { active: {}, all: {} } };

const Purchases = {
  setLogLevel: async () => undefined,
  configure: () => undefined,
  logIn: async () => ({ customerInfo: emptyCustomerInfo, created: false }),
  logOut: async () => emptyCustomerInfo,
  getCustomerInfo: async () => emptyCustomerInfo,
  getOfferings: async () => ({ current: null, all: {} }),
  restorePurchases: async () => emptyCustomerInfo,
  addCustomerInfoUpdateListener: () => undefined,
  removeCustomerInfoUpdateListener: () => false,
};

export default Purchases;
