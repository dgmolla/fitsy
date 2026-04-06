export const COST_CONFIG = {
  models: {
    "claude-haiku-4-5":   { input: 0.0000008, output: 0.000004  },
    "claude-sonnet-4-5":  { input: 0.000003,  output: 0.000015  },
    "claude-opus-4-6":    { input: 0.000015,  output: 0.000075  },
    "local":              { input: 0,          output: 0          },
  } as Record<string, { input: number; output: number }>,

  services: {
    firecrawl:     { perSearch: 0.006, perScrape: 0.003, perMap: 0.002 },
    googlePlaces:  { perNearbySearch: 0.005, perPhoto: 0.007 },
  },

  caps: {
    evalRunMaxUsd:       0.50,
    evalRunWarnUsd:      0.10,
    preloadRunMaxUsd:    5.00,
    preloadRunWarnUsd:   1.00,
    monthlyBudgetUsd:   25.00,
  },

  estimates: {
    avgTokensPerItem:   { input: 300, output: 200 },
    avgTokensPerMenu:   { input: 2000, output: 1500 },
  },
};
