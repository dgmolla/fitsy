/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      displayName: 'lib',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/lib/**/*.test.ts'],
      testPathIgnorePatterns: ['<rootDir>/lib/useLocation.test.ts', '<rootDir>/lib/useEntitlementSelfHeal.test.ts'],
      moduleNameMapper: {
        '^@fitsy/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^@fitsy/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
        '^expo-location$': '<rootDir>/__mocks__/expo-location.ts',
        '^expo-apple-authentication$': '<rootDir>/__mocks__/expo-apple-authentication.ts',
        '^expo-auth-session(/.*)?$': '<rootDir>/__mocks__/expo-auth-session.ts',
        '^expo-web-browser$': '<rootDir>/__mocks__/expo-web-browser.ts',
        '^expo-router$': '<rootDir>/__mocks__/expo-router.ts',
        '^expo-crypto$': '<rootDir>/__mocks__/expo-crypto.ts',
        '^@supabase/supabase-js$': '<rootDir>/__mocks__/supabase-js.ts',
        '^react-native-url-polyfill/auto$': '<rootDir>/__mocks__/react-native-url-polyfill-auto.ts',
        '^expo-secure-store$': '<rootDir>/__mocks__/expo-secure-store.ts',
        '^react-native$': '<rootDir>/__mocks__/react-native.ts',
        '^react-native-purchases$': '<rootDir>/__mocks__/react-native-purchases.ts',
        '^react-native-purchases-ui$': '<rootDir>/__mocks__/react-native-purchases-ui.ts',
        '^expo-constants$': '<rootDir>/__mocks__/expo-constants.ts',
      },
      transform: {
        '^.+\\.tsx?$': [
          'ts-jest',
          {
            tsconfig: {
              module: 'CommonJS',
              moduleResolution: 'node',
              paths: {},
              strict: true,
            },
          },
        ],
      },
    },
    {
      displayName: 'hooks',
      preset: 'jest-expo',
      testEnvironment: 'node',
      testMatch: [
        '<rootDir>/lib/useLocation.test.ts',
        '<rootDir>/lib/useEntitlementSelfHeal.test.ts',
        '<rootDir>/components/CoachMarks.test.tsx',
      ],
      moduleNameMapper: {
        '^@fitsy/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^@fitsy/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
        '^expo-location$': '<rootDir>/__mocks__/expo-location.ts',
        '^expo-apple-authentication$': '<rootDir>/__mocks__/expo-apple-authentication.ts',
        '^expo-auth-session(/.*)?$': '<rootDir>/__mocks__/expo-auth-session.ts',
        '^expo-web-browser$': '<rootDir>/__mocks__/expo-web-browser.ts',
        '^expo-router$': '<rootDir>/__mocks__/expo-router.ts',
        '^expo-crypto$': '<rootDir>/__mocks__/expo-crypto.ts',
      },
    },
  ],
};

module.exports = config;
