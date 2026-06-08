/**
 * Jest mock for `react-native-purchases-ui` (RevenueCatUI).
 * See react-native-purchases.ts mock for the rationale.
 */
export enum PAYWALL_RESULT {
  NOT_PRESENTED = 'NOT_PRESENTED',
  ERROR = 'ERROR',
  CANCELLED = 'CANCELLED',
  PURCHASED = 'PURCHASED',
  RESTORED = 'RESTORED',
}

const RevenueCatUI = {
  PAYWALL_RESULT,
  presentPaywall: async () => PAYWALL_RESULT.PURCHASED,
  presentPaywallIfNeeded: async () => PAYWALL_RESULT.PURCHASED,
  presentCustomerCenter: async () => undefined,
};

export default RevenueCatUI;
