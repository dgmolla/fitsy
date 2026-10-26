/** @type {import('jest').Config} */
const config = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "node",
          strict: true,
        },
      },
    ],
  },
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    "^(\\.\\.?/.*)\\.js$": "$1",
    "^@fitsy/shared$": "<rootDir>/../packages/shared/src/index.ts",
    "^@fitsy/shared/(.*)$": "<rootDir>/../packages/shared/src/$1",
  },
};

module.exports = config;
