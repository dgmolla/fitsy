import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const source = resolve(__dirname, "../..");
let root: string;
let calls: string;
let cache: string;
let env: NodeJS.ProcessEnv;
const verdict = JSON.stringify({ lens: "correctness", verdict: "pass", findings: [] });
function git(...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
function run(model = "fixture-model", provider = "claude") {
  return spawnSync("bash", ["scripts/review/run-lens.sh", "--local", "correctness"], {
    cwd: root, encoding: "utf8", env: { ...env, FITSY_REVIEW_MODEL: model, FITSY_REVIEW_PROVIDER: provider }, timeout: 15000,
  });
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fitsy-review-runner-"));
  calls = join(root, "calls"); cache = join(root, "cache");
  mkdirSync(join(root, "scripts/review"), { recursive: true });
  mkdirSync(join(root, "scripts/verify"), { recursive: true });
  mkdirSync(join(root, ".claude/lenses"), { recursive: true });
  mkdirSync(join(root, "bin"));
  for (const name of ["run-lens.sh", "execute-review.py", "extract-verdict.py", "tier.mjs"]) {
    cpSync(join(source, "scripts/review", name), join(root, "scripts/review", name));
  }
  cpSync(join(source, "scripts/verify/risk-tiers.yml"), join(root, "scripts/verify/risk-tiers.yml"));
  writeFileSync(join(root, "REVIEW.md"), "Review rules\n");
  writeFileSync(join(root, ".claude/lenses/correctness.md"), "Review correctness.\n");
  writeFileSync(join(root, "app.ts"), "export const value = 1;\n");
  const cli = `#!/usr/bin/env python3
import json,os,pathlib,sys
if '--version' in sys.argv:
 print('fixture-cli 1.0'); sys.exit(0)
with open(${JSON.stringify(calls)},'a') as f: f.write('called\\n')
result=pathlib.Path(${JSON.stringify(join(root, 'verdict'))}).read_text()
if '--output-last-message' in sys.argv:
 pathlib.Path(sys.argv[sys.argv.index('--output-last-message')+1]).write_text(result)
elif '-o' in sys.argv:
 pathlib.Path(sys.argv[sys.argv.index('-o')+1]).write_text(result)
print(json.dumps({'is_error':False,'result':result}))
sys.exit(int(pathlib.Path(${JSON.stringify(join(root, 'exit'))}).read_text()))
`;
  writeFileSync(join(root, "verdict"), verdict); writeFileSync(join(root, "exit"), "0");
  for (const name of ["claude", "codex"]) writeFileSync(join(root, "bin", name), cli, { mode: 0o755 });
  env = { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH, FITSY_REVIEW_CACHE: cache,
    REVIEW_TEST_CALLS: calls, REVIEW_TEST_VERDICT: verdict };
  git("init", "-q"); git("config", "user.name", "Review fixture"); git("config", "user.email", "fixture@example.test");
  git("add", "."); git("commit", "-qm", "base"); git("update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(root, "app.ts"), "export const value = 2;\n"); git("add", "app.ts"); git("commit", "-qm", "change");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

test("local caller runs independent CLI, records identity, and reuses only matching cache", () => {
  const first = run();
  expect(first.stderr).not.toContain("Traceback");
  expect(first.status).toBe(0);
  expect(JSON.parse(first.stdout)).toMatchObject({ verdict: "pass", reviewer: { provider: "claude", model: "fixture-model" } });
  expect(run().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(1);
  expect(run("different-model").status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});
test("nonzero external execution cannot publish or cache a partial pass", () => {
  writeFileSync(join(root, "exit"), "1");
  const result = run();
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "fail", findings: [{ file: "(runner)" }] });
  expect(readdirSync(cache).filter(name => name.endsWith(".json"))).toHaveLength(0);
  writeFileSync(join(root, "exit"), "0");
  expect(run().status).toBe(0);
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});
test("provider identity separates cache entries", () => {
  expect(run().status).toBe(0);
  const codex = run("fixture-model", "codex");
  expect(codex.status).toBe(0);
  expect(JSON.parse(codex.stdout)).toMatchObject({ reviewer: { provider: "codex" } });
  expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(2);
});
