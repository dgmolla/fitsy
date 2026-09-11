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

export enum INTRO_ELIGIBILITY_STATUS {
  INTRO_ELIGIBILITY_STATUS_UNKNOWN = 0,
  INTRO_ELIGIBILITY_STATUS_INELIGIBLE = 1,
  INTRO_ELIGIBILITY_STATUS_ELIGIBLE = 2,
  INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS = 3,
}

const Purchases = {
  setLogLevel: async () => undefined,
  configure: () => undefined,
  logIn: async () => ({ customerInfo: emptyCustomerInfo, created: false }),
  logOut: async () => emptyCustomerInfo,
  getCustomerInfo: async () => emptyCustomerInfo,
  getOfferings: async () => ({ current: null, all: {} }),
  checkTrialOrIntroductoryPriceEligibility: async (_ids: string[]): Promise<Record<string, { status: number; description: string }>> => ({}),
  restorePurchases: async () => emptyCustomerInfo,
  addCustomerInfoUpdateListener: () => undefined,
  removeCustomerInfoUpdateListener: () => false,
  showManageSubscriptions: async () => undefined,
};

export default Purchases;
