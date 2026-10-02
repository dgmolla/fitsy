import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("poller retries the latest error and revalidates completed gates without provider execution", () => {
  const home = mkdtempSync(join(tmpdir(), "fitsy-poller-status-"));
  const repo = join(home, "repo");
  const bin = join(home, "bin");
  const calls = join(home, "review-calls");
  const statuses = join(home, "statuses.json");
  try {
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(repo, "scripts/review"), { recursive: true });
    mkdirSync(bin);
    cpSync(join(__dirname, "poller.sh"), join(repo, "scripts/review/poller.sh"));
    cpSync(join(__dirname, "poller-status.jq"), join(repo, "scripts/review/poller-status.jq"));
    writeFileSync(join(repo, "scripts/review/tier.mjs"), 'process.stdout.write("medium\\n")\n');
    writeFileSync(join(repo, "scripts/review/run-review.sh"), 'if [ "$2" = --identity ]; then printf \'{"cache_key":"fixture","domains":["correctness","workflow-security"]}\\n\'; exit; fi\nif [ \"$2\" = --cached-only ]; then printf \"%s\\n\" cached-gate >> \"$FITSY_REVIEW_TEST_CALLS.cached\"; exit; fi\nprintf "%s\\n" "review-round" >> "$FITSY_REVIEW_TEST_CALLS"\n');
    writeFileSync(join(bin, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(bin, "gh"), `#!/bin/sh
if [ "$1" = pr ] && [ "$2" = list ]; then printf '7 deadbeef\\n'; exit; fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  case "$5" in files) printf 'apps/mobile/components/Home.tsx\\n' ;; labels|body) printf '\\n' ;; esac
  exit
fi
if [ "$1" = api ]; then cat "$FITSY_REVIEW_TEST_STATUSES"; exit; fi
exit 1
`, { mode: 0o755 });
    const env = { ...process.env, FITSY_REVIEW_HOME: home, FITSY_GH_BIN: join(bin, "gh"),
      FITSY_REVIEW_TEST_CALLS: calls, FITSY_REVIEW_TEST_STATUSES: statuses,
      PATH: `${bin}:${process.env.PATH}` };
    const tick = () => execFileSync("bash", [join(repo, "scripts/review/poller.sh")], { env, cwd: repo });
    const status = (state: string, id: number) => ({ context: "review/round", state, id, description: state === "error" ? "execution/timeout: independent review incomplete" : "round-key:fixture complete:pass", created_at: "2026-09-26T08:00:00Z" });
    writeFileSync(statuses, JSON.stringify([status("success", 1), status("error", 2)]));
    tick();
    expect(readFileSync(calls, "utf8")).toBe("review-round\n");
    writeFileSync(statuses, JSON.stringify([status("error", 2), status("success", 3)]));
    tick();
    expect(readFileSync(calls, "utf8")).toBe("review-round\n");
    expect(readFileSync(calls + ".cached", "utf8")).toBe("cached-gate\n");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
