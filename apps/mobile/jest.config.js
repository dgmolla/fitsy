/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      displayName: 'lib',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/lib/**/*.test.ts'],
      testPathIgnorePatterns: ['<rootDir>/lib/useLocation.test.ts'],
      moduleNameMapper: {
        '^@fitsy/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^@fitsy/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
        '^expo-location$': '<rootDir>/__mocks__/expo-location.ts',
        '^expo-apple-authentication$': '<rootDir>/__mocks__/expo-apple-authentication.ts',
        '^expo-auth-session(/.*)?$': '<rootDir>/__mocks__/expo-auth-session.ts',
        '^expo-web-browser$': '<rootDir>/__mocks__/expo-web-browser.ts',
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
      testMatch: ['<rootDir>/lib/useLocation.test.ts'],
      moduleNameMapper: {
        '^@fitsy/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^@fitsy/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
        '^expo-location$': '<rootDir>/__mocks__/expo-location.ts',
        '^expo-apple-authentication$': '<rootDir>/__mocks__/expo-apple-authentication.ts',
        '^expo-auth-session(/.*)?$': '<rootDir>/__mocks__/expo-auth-session.ts',
        '^expo-web-browser$': '<rootDir>/__mocks__/expo-web-browser.ts',
      },
    },
  ],
};

module.exports = config;
