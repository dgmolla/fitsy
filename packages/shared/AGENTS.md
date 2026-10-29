# Shared agent guide

Run commands from the repository root:

```sh
npm test -w packages/shared
npm run lint -w packages/shared
npm run type-check -w packages/shared
```

`src/contracts/` holds Zod wire contracts, `src/types/` domain types, and `src/utils/` pure matching, macro math and date utilities.
Keep these usable by API and mobile without native initialization or database access.
Test actual exported behavior beside its source with unequal values, boundaries and explicit invalid cases.
Expected results must come from the contract, not a second copy of the algorithm or the same helper pipeline.
Do not mock the function under test or use live database/seed contents for pure tests.
Preserve strict TypeScript and explicit-`any` errors; narrow untrusted input from `unknown`.
Contract changes require checking both API producers and mobile consumers.
