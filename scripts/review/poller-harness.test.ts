import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("trusted poller restoration removes PR-owned and untracked Python import siblings", () => {
  const root = mkdtempSync(join(tmpdir(), "fitsy-harness-"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  const run = (command: string, args: string[]) => execFileSync(command, args, { cwd: root, env, stdio: "pipe" });
  const git = (...args: string[]) => run("git", args);
  try {
    git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
    for (const dir of ["scripts/review", "scripts/delivery", "scripts/verify", ".claude/lenses"]) mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, "scripts/review/probe.py"), "import json\n");
    for (const path of ["scripts/delivery/phase-events.mjs", "scripts/verify/risk-tiers.yml", "REVIEW.md", ".claude/lenses/correctness.md"]) writeFileSync(join(root, path), "trusted\n");
    git("add", "."); git("commit", "-qm", "trusted main"); git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(root, "scripts/review/json.py"), "from pathlib import Path\nPath('import-marker').write_text('candidate executed')\n");
    git("add", "."); git("commit", "-qm", "PR-only import");
    git("checkout", "origin/main", "--", "scripts/review");
    run("python3", ["scripts/review/probe.py"]);
    expect(existsSync(join(root, "import-marker"))).toBe(true);
    rmSync(join(root, "import-marker"));
    writeFileSync(join(root, "scripts/review/ignored.py"), "untrusted\n");
    const script = readFileSync(join(__dirname, "poller.sh"), "utf8");
    const restore = script.match(/git restore --source=origin\/main[^\n]+/)!;
    const clean = script.match(/git clean -qfdx[^\n]+/)!;
    expect(restore).not.toBeNull(); expect(clean).not.toBeNull();
    run("bash", ["-c", `${restore[0].replace(/ &&$/, "")} && ${clean[0].replace(/\); then$/, "")}`]);
    run("python3", ["scripts/review/probe.py"]);
    expect(existsSync(join(root, "import-marker"))).toBe(false);
    expect(existsSync(join(root, "scripts/review/json.py"))).toBe(false);
    expect(existsSync(join(root, "scripts/review/ignored.py"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
