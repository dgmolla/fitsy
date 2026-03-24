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
      displayName: 'components',
      preset: 'jest-expo',
      testMatch: ['<rootDir>/components/**/*.test.tsx', '<rootDir>/app/**/*.test.tsx'],
      moduleNameMapper: {
        '^@fitsy/shared$': '<rootDir>/../../packages/shared/src/index.ts',
        '^@fitsy/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
      },
    },
  ],
};

module.exports = config;
