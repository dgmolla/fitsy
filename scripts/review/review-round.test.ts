import { spawnSync } from "node:child_process";
import { join } from "node:path";

const domains = "correctness danger-zone workflow-security";
const run = (value: unknown, projection?: string) => {
  const result = spawnSync("python3", ["-I", join(__dirname, "review-round.py"), domains, ...(projection ? ["--project", projection] : [])], { input: JSON.stringify(value), encoding: "utf8" });
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
};
const finding = { severity: "CONFIRMED", priority: "P1", impact: "Unauthorized access", file: "auth.ts", line: 1, summary: "Authorization bypass", scenario: "guest -> protected data", fix: "Check entitlement", domains: ["danger-zone"] };

test("complete round deduplicates behavior and preserves strongest evidence and every domain", () => {
  const result = run({ verdict: "fail", domains: { correctness: "pass", "danger-zone": "fail", "workflow-security": "pass" }, findings: [finding, { ...finding, severity: "PLAUSIBLE", priority: "P3", domains: ["correctness"] }] });
  expect(result.findings).toHaveLength(1);
  expect(result.findings[0]).toMatchObject({ severity: "CONFIRMED", priority: "P1", domains: ["correctness", "danger-zone"] });
  expect(result.domains.correctness).toBe("fail");
  expect(run(result, "correctness").findings[0].priority).toBe("P1");
});

test.each([
  { correctness: "pass", "danger-zone": "pass" },
  { correctness: "pass", "danger-zone": "pass", "workflow-security": "pass", invented: "pass" },
])("partial or unknown domain coverage cannot yield success", coverage => {
  const value = { verdict: "pass", domains: coverage, findings: [] };
  for (const domain of domains.split(" ")) expect(run(value, domain).verdict).toBe("incomplete");
});

test("domain verdict inconsistent with confirmed finding is incomplete", () => {
  expect(run({ verdict: "fail", domains: { correctness: "pass", "danger-zone": "pass", "workflow-security": "pass" }, findings: [finding] }).verdict).toBe("incomplete");
});

test("sensitive routing cannot be reduced by an additive override", () => {
  const paths = "apps/api/lib/auth.ts\nscripts/review/run-review.sh\n";
  const result = spawnSync("python3", ["-I", join(__dirname, "review-domains.py"), "--add-domain", "correctness"], { input: paths, encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe(domains);
  const invalid = spawnSync("python3", ["-I", join(__dirname, "review-domains.py"), "--add-domain", "none"], { input: paths, encoding: "utf8" });
  expect(invalid.status).not.toBe(0);
});


test.each(["shipping.md", "review-dispositions.md", "agent-model-routing.md", "task-management.md", "autonomous-shipping.md"])("review and release policy %s requires security in the same round", file => {
  const result = spawnSync("python3", ["-I", join(__dirname, "review-domains.py")], { input: `docs/engineering/devops/${file}\n`, encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("correctness workflow-security");
});

test("deduplication preserves the most severe confirmed assessment without borrowing plausible priority", () => {
  const confirmed = { ...finding, priority: "P3", domains: ["correctness"], impact: "Confirmed limited impact" };
  const plausible = { ...finding, severity: "PLAUSIBLE", priority: "P1", domains: ["workflow-security"], impact: "Unconfirmed larger impact" };
  for (const findings of [[confirmed, plausible], [plausible, confirmed]]) {
    const result = run({ verdict: "fail", domains: { correctness: "fail", "danger-zone": "pass", "workflow-security": "pass" }, findings });
    expect(result.findings[0]).toMatchObject({ severity: "CONFIRMED", priority: "P3", impact: confirmed.impact, domains: ["correctness", "workflow-security"] });
  }
});
