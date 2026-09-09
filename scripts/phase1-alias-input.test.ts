import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVerifiedAliases, VERIFIED_ALIASES_FILENAME } from "./phase1-alias-input";
let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), "fitsy-reviewed-aliases-")); });
afterEach(() => { rmSync(directory, { recursive: true, force: true }); });
test("uses the verifier's HIGH artifact despite conflicting raw and medium candidates", () => {
  const high = { "waba-grill": { "chicken-plate": ["chicken-plate"] } };
  writeFileSync(join(directory, VERIFIED_ALIASES_FILENAME), JSON.stringify(high));
  for (const filename of ["aliases.json", "aliases-medium.json", "aliases-verified.json"]) {
    writeFileSync(join(directory, filename), JSON.stringify({ "waba-grill": { chicken: ["chicken-plate"] } }));
  }
  expect(loadVerifiedAliases(directory)).toEqual(high);
});
test("absence of HIGH fails even when historical/raw filenames exist", () => {
  for (const filename of ["aliases.json", "aliases-verified.json"]) writeFileSync(join(directory, filename), "{}");
  expect(() => loadVerifiedAliases(directory)).toThrow("Missing verified aliases");
});
test.each(["{", "[]", '{"waba":{"chicken":"plate"}}', '{"waba":{"chicken":[""]}}', '{"waba":{"chicken":[1]}}'])
("malformed verified data is rejected: %s", raw => {
  writeFileSync(join(directory, VERIFIED_ALIASES_FILENAME), raw);
  expect(() => loadVerifiedAliases(directory)).toThrow();
});
