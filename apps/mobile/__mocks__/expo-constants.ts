/**
 * Jest mock for `expo-constants`. Provides the `extra` block our code reads
 * (RevenueCat keys). Tests can override `default.expoConfig.extra` as needed.
 */
const Constants = {
  expoConfig: {
    extra: {
      revenueCat: {
        ios: 'appl_test_ios_key',
        android: 'goog_test_android_key',
      },
    },
  },
};

export default Constants;
