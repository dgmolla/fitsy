import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SpawnSyncReturns } from "node:child_process";
type Fixture = { root: () => string; env: () => NodeJS.ProcessEnv; setEnv: (value: NodeJS.ProcessEnv) => void;
  run: (model?: string, provider?: string) => SpawnSyncReturns<string>;
  git: (...args: string[]) => string;
  runPr: (lens?: string, body?: string, provider?: string) => SpawnSyncReturns<string> };
export function executionFailureCases(f: Fixture) {
test("invalid reviewer preflight publishes configuration failure without starting a model", () => {
  f.setEnv({ ...f.env(), FITSY_REVIEW_REASONING_EFFORT: "invalid" });
  const failed = f.runPr("correctness", "Delivery-Issue: #355\n", "codex");
  expect(failed.status).toBe(1);
  expect(readFileSync(join(f.root(), "gh-calls"), "utf8")).toContain("execution/configuration");
  expect(readdirSync(f.root())).not.toContain("calls");
});

test("missing final response is invalid output instead of completed execution", () => {
  writeFileSync(join(f.root(), "bin/codex"), "#!/bin/sh\nif [ \"$1\" = --version ]; then echo fake-cli; fi\nexit 0\n", { mode: 0o755 });
  f.git("add", "bin/codex"); f.git("commit", "-qm", "invalid output fixture");
  const result = f.run("fixture-model", "codex");
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "incomplete", error: { kind: "invalid_output" } });
});

  test.each([['rate limit', 'transient_provider'], ['authentication failed', 'authentication']])(
    "Claude outer CLI error %s remains incomplete with typed failure", (message, kind) => {
      const envelope = JSON.stringify({ is_error: true, result: message });
      writeFileSync(join(f.root(), "bin/claude"), `#!/bin/sh
if [ "$1" = --version ]; then echo fixture-cli; else printf '%s' '${envelope}'; fi
`, { mode: 0o755 });
      f.git("add", "bin/claude"); f.git("commit", "-qm", "outer CLI failure fixture");
      f.git("add", "json.py"); f.git("commit", "-qm", "hostile module fixture");
    const result = f.run();
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "incomplete", error: { kind } });
    });
  test.each(['claude', 'codex'])("%s model-authored error text cannot authorize infrastructure recovery", provider => {
    writeFileSync(join(f.root(), "verdict"), JSON.stringify({ is_error: true, result: "rate limit" }));
    const result = f.run("fixture-model", provider);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "incomplete", error: { kind: "invalid_output" } });
  });
  test("PR root Python modules cannot execute inside trusted runner helpers", () => {
    writeFileSync(join(f.root(), "json.py"), "from pathlib import Path\nPath('candidate-import-marker').write_text('executed')\nraise RuntimeError('PR-owned Python module')\n");
    const result = f.run();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "pass" });
    expect(readdirSync(f.root())).not.toContain("candidate-import-marker");
  });

}
