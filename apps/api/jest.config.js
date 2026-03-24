/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  moduleNameMapper: {
    "^@fitsy/shared$":
      "<rootDir>/../../packages/shared/src/index.ts",
    "^@fitsy/shared/(.*)$":
      "<rootDir>/../../packages/shared/src/$1",
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "node",
          paths: {},
          strict: true,
        },
      },
    ],
  },
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
};

module.exports = config;
