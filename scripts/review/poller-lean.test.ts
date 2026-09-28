import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "fitsy-poller-lean-"));
  const repo = join(home, "repo");
  const bin = join(home, "bin");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, "scripts/review"), { recursive: true });
  mkdirSync(bin);
  for (const file of ["poller.sh", "poller-status.jq"]) cpSync(join(__dirname, file), join(repo, "scripts/review", file));
  writeFileSync(join(repo, "scripts/review/tier.mjs"), 'process.stdout.write(process.env.REVIEW_TEST_TIER || "medium")\n');
  writeFileSync(join(repo, "scripts/review/run-lens.sh"), 'printf "%s\\n" "$2" >> "$REVIEW_TEST_CALLS"\n');
  writeFileSync(join(bin, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(bin, "gh"), `#!/bin/sh
if [ "$1" = pr ] && [ "$2" = list ]; then printf '7 deadbeef\\n'; exit; fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  case "$5" in
    files) cat "$REVIEW_TEST_FILES" ;;
    labels) cat "$REVIEW_TEST_LABELS" ;;
    body) cat "$REVIEW_TEST_BODY" ;;
  esac
  exit
fi
if [ "$1" = api ]; then
  if [ "$3" = -f ]; then printf '%s\\n' "$*" >> "$REVIEW_TEST_POSTS"; exit; fi
  cat "$REVIEW_TEST_STATUSES"; exit
fi
exit 1
`, { mode: 0o755 });
  const files = join(home, "files"), labels = join(home, "labels"), body = join(home, "body");
  const statuses = join(home, "statuses"), calls = join(home, "calls"), posts = join(home, "posts");
  for (const path of [files, labels, body, calls, posts]) writeFileSync(path, "");
  writeFileSync(statuses, "[]");
  const env = { ...process.env, FITSY_REVIEW_HOME: home, FITSY_GH_BIN: join(bin, "gh"),
    REVIEW_TEST_FILES: files, REVIEW_TEST_LABELS: labels, REVIEW_TEST_BODY: body,
    REVIEW_TEST_STATUSES: statuses, REVIEW_TEST_CALLS: calls, REVIEW_TEST_POSTS: posts,
    PATH: `${bin}:${process.env.PATH}` };
  return { home, files, labels, body, statuses, calls, posts,
    tick: (tier = "medium") => execFileSync("bash", [join(repo, "scripts/review/poller.sh")], {
      cwd: repo, env: { ...env, REVIEW_TEST_TIER: tier }, encoding: "utf8",
    }),
  };
}

test("ordinary test, spec and incident metadata gets one correctness review", () => {
  const f = fixture();
  try {
    writeFileSync(f.files, "scripts/feature/example.test.ts\n");
    writeFileSync(f.labels, "incident\n");
    writeFileSync(f.body, "Spec: https://example.invalid/acceptance\n");
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("correctness\n");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test("actual sensitive source adds only its matching specialist", () => {
  const f = fixture();
  try {
    writeFileSync(f.files, "apps/api/lib/auth.ts\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("correctness\ndanger-zone\n");
    writeFileSync(f.calls, "");
    writeFileSync(f.files, "scripts/review/poller.sh\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("correctness\nworkflow-security\n");
    writeFileSync(f.calls, "");
    writeFileSync(f.files, "apps/api/lib/auth.test.ts\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("correctness\n");
    writeFileSync(f.calls, "");
    writeFileSync(f.files, "apps/api/services/menuSources/uberEatsSource.ts\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("correctness\n");
    for (const path of ["apps/mobile/lib/usePurchases.tsx", "prisma/migrations/20260928/migration.sql"]) {
      writeFileSync(f.calls, "");
      writeFileSync(f.files, `${path}\n`);
      f.tick("high");
      expect(readFileSync(f.calls, "utf8")).toBe("correctness\ndanger-zone\n");
    }
    writeFileSync(f.calls, "");
    writeFileSync(f.files, ".github/workflows/deploy.yml\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("correctness\nworkflow-security\n");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test("two incomplete same-head reviews stop automatic retries and request coordination", () => {
  const f = fixture();
  try {
    const error = (id: number) => ({ context: "lens/correctness", state: "error", id, created_at: `2026-09-28T00:00:0${id}Z` });
    writeFileSync(f.statuses, JSON.stringify([error(1)]));
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("correctness\n");
    writeFileSync(f.calls, "");
    writeFileSync(f.statuses, JSON.stringify([error(1), error(2)]));
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("");
    expect(readFileSync(f.posts, "utf8")).toContain("needs-coordinator");
    expect(readFileSync(f.posts, "utf8")).toContain("state=failure");
    const posts = readFileSync(f.posts, "utf8");
    writeFileSync(f.statuses, JSON.stringify([error(1), error(2), { ...error(3), state: "failure" }]));
    f.tick();
    expect(readFileSync(f.posts, "utf8")).toBe(posts);
    writeFileSync(f.statuses, "not JSON");
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});
