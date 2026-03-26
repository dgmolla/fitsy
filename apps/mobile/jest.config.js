/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      displayName: 'lib',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/lib/**/*.test.ts'],
      moduleNameMapper: {
        '^@fitsy/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^@fitsy/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
        '^expo-secure-store$': '<rootDir>/__mocks__/expo-secure-store.ts',
        '^expo-location$': '<rootDir>/__mocks__/expo-location.ts',
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
  ],
};

module.exports = config;
