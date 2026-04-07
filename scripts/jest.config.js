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
};

module.exports = config;
