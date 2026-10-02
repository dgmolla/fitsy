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

test("installed launcher retains trusted main outside a PR-mutated clone", () => {
  const root = mkdtempSync(join(tmpdir(), "fitsy-poller-install-"));
  const home = join(root, "home"), repo = join(home, ".fitsy-review/repo"), bin = join(root, "bin");
  mkdirSync(repo, { recursive: true }); mkdirSync(bin);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` };
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe" });
  try {
    git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.test");
    mkdirSync(join(repo, "scripts/review"), { recursive: true });
    writeFileSync(join(repo, "scripts/review/poller.sh"), "#!/bin/bash\necho trusted-launcher\n");
    git("add", "."); git("commit", "-qm", "main"); git("branch", "-M", "main"); git("remote", "add", "origin", repo);
    writeFileSync(join(bin, "launchctl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    execFileSync("bash", [join(__dirname, "install-poller.sh")], { env, stdio: "pipe" });
    writeFileSync(join(repo, "scripts/review/poller.sh"), "#!/bin/bash\necho candidate-executed\n");
    const installed = join(home, ".fitsy-review/runtime/poller.sh");
    expect(readFileSync(join(home, "Library/LaunchAgents/com.fitsy.review-poller.plist"), "utf8")).toContain(installed);
    expect(execFileSync("bash", [installed], { env, encoding: "utf8" }).trim()).toBe("trusted-launcher");
    const plist = join(home, "Library/LaunchAgents/com.fitsy.review-poller.plist");
    const configured = readFileSync(plist, "utf8").replace("<dict>\n    <key>PATH", "<dict>\n    <key>FITSY_REVIEW_PROVIDER</key><string>codex</string>\n    <key>PATH");
    writeFileSync(plist, configured);
    execFileSync("bash", [join(__dirname, "install-poller.sh"), "--refresh-runtime"], { env, stdio: "pipe" });
    expect(readFileSync(plist, "utf8")).toBe(configured);
    expect(execFileSync("bash", [installed], { env, encoding: "utf8" }).trim()).toBe("trusted-launcher");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
