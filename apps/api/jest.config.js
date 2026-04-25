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
    "^.+\\.jsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "node",
          allowJs: true,
          paths: {},
          strict: false,
        },
      },
    ],
  },
  transformIgnorePatterns: [
    "node_modules/(?!@t3-oss/)",
  ],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  collectCoverageFrom: [
    "lib/**/*.ts",
    "services/**/*.ts",
    "app/api/auth/**/*.ts",
    "!**/*.test.ts",
    "!**/.gitkeep",
    // External API wrappers — require integration test infrastructure, excluded from unit coverage
    "!services/googlePlacesService.ts",
    "!services/menuSources/firecrawlSource.ts",
    "!services/menuSources/ueSitemapIndex.ts",
    "!services/scrapers/jinaScraper.ts",
    "!services/scrapers/firecrawlScraper.ts",
  ],
  coverageThreshold: {
    global: {
      lines: 80,
      functions: 80,
      branches: 70,
      statements: 80,
    },
  },
  coverageReporters: ["text", "lcov"],
};

module.exports = config;
