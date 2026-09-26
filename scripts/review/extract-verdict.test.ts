import { execFileSync } from "node:child_process";
import { join } from "node:path";

const extractor = join(__dirname, "extract-verdict.py");
const pass = { lens: "correctness", verdict: "pass", findings: [] };
const finding = { severity: "CONFIRMED", priority: "P1", impact: "Core flow fails for an empty user input", file: "app.ts", line: 3, summary: "Wrong output", scenario: "Empty input crashes", fix: "Handle empty input" };
function extract(input: unknown, lens = "correctness", executionError = false) {
  return JSON.parse(execFileSync("python3", [extractor, lens, ...(executionError ? ["--execution-error"] : [])], {
    input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8",
  }));
}
function runnerFailure(input: unknown) {
  expect(extract(input)).toMatchObject({ verdict: "incomplete", findings: [], error: { kind: "invalid_output" } });
}

test("accepts a complete plain provider verdict and a successful Claude envelope", () => {
  expect(extract(pass)).toEqual(pass);
  expect(extract({ is_error: false, result: "Review complete.\n```json\n" + JSON.stringify(pass) + "\n```" })).toEqual(pass);
});
test("preserves confirmed findings and recorded runner provenance", () => {
  const fail = { ...pass, verdict: "fail", findings: [finding], reviewer: { provider: "codex", model: "configured-model" } };
  expect(extract(fail)).toEqual(fail);
});
test("rejects authentication errors even when their result contains a pass", () => {
  runnerFailure({ is_error: true, result: JSON.stringify(pass) });
  runnerFailure({ error: "expired auth", result: JSON.stringify(pass) });
});
test("failed execution cannot salvage a complete pass from partial output", () => {
  expect(extract(pass, "correctness", true)).toMatchObject({
    verdict: "incomplete", findings: [], error: { kind: "execution_error" },
  });
});
test.each([
  { verdict: "pass" }, { ...pass, lens: "test-quality" }, { ...pass, findings: null },
  { ...pass, findings: [finding] }, { ...pass, verdict: "fail" },
  { ...pass, findings: [{ ...finding, severity: "UNKNOWN" }] },
  { ...pass, verdict: "fail", findings: [{ ...finding, priority: undefined }] },
  { ...pass, verdict: "fail", findings: [{ ...finding, priority: "P9" }] },
  { ...pass, verdict: "fail", findings: [{ ...finding, impact: "" }] },
  { ...pass, verdict: "fail", findings: [{ ...finding, line: -1 }] },
  { ...pass, verdict: "fail", findings: [{ ...finding, fix: "" }] },
  { ...pass, verdict: "fail", findings: [{ ...finding, line: true }] },
])("rejects incomplete or contradictory verdict %j", runnerFailure);
test("rejects ambiguous verdict blocks and partial output", () => {
  const block = "```json\n" + JSON.stringify(pass) + "\n```";
  runnerFailure(block + "\n" + block);
  runnerFailure('{"lens":"correctness","verdict":"pass"');
});

test("preserves confirmed advisory docs findings using the same verdict contract", () => {
  const advisory = { lens: "docs-sanity", verdict: "fail", findings: [finding] };
  expect(extract(advisory, "docs-sanity")).toEqual(advisory);
});
