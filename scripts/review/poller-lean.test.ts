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
  writeFileSync(join(repo, "scripts/review/run-review.sh"), 'if [ "$2" = --identity ]; then printf \'{"cache_key":"fixture","domains":["correctness","workflow-security"]}\\n\'; exit; fi\nprintf "%s\\n" "review-round" >> "$REVIEW_TEST_CALLS"\nprintf "%s\\n" "$FITSY_REVIEW_TIMEOUT_SECONDS" >> "$REVIEW_TEST_CALLS.timeouts"\n');
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

test("ordinary changes schedule one complete round", () => {
  const f = fixture();
  try {
    writeFileSync(f.files, "scripts/feature/example.test.ts\n");
    writeFileSync(f.labels, "incident\n");
    writeFileSync(f.body, "Spec: https://example.invalid/acceptance\n");
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test("sensitive source still schedules exactly one round", () => {
  const f = fixture();
  try {
    writeFileSync(f.files, "apps/api/lib/auth.ts\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    writeFileSync(f.calls, "");
    writeFileSync(f.files, "scripts/review/poller.sh\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    writeFileSync(f.calls, "");
    writeFileSync(f.files, "apps/api/lib/auth.test.ts\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    writeFileSync(f.calls, "");
    writeFileSync(f.files, "apps/api/services/menuSources/uberEatsSource.ts\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    for (const path of ["apps/mobile/lib/usePurchases.tsx", "apps/mobile/lib/authClient.ts", "apps/mobile/lib/entitlement.ts", "apps/mobile/lib/useEntitlementVerdict.ts", "apps/mobile/app/welcome/resubscribe.tsx", "prisma/migrations/20260928/migration.sql", "apps/api/app/api/subscriptions/sync/route.ts", "apps/api/app/api/restaurants/route.ts", "apps/api/app/api/restaurants/[id]/menu/route.ts", "apps/api/app/api/user/route.ts"]) {
      writeFileSync(f.calls, "");
      writeFileSync(f.files, `${path}\n`);
      f.tick("high");
      expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    }
    writeFileSync(f.calls, "");
    writeFileSync(f.files, ".github/workflows/deploy.yml\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    for (const path of ["REVIEW.md", ".claude/lenses/workflow-security.md", ".github/workflows/deploy.test.yml", "scripts/review/poller-status.jq", "docs/engineering/devops/shipping.md", "scripts/verify/registry.yml", "scripts/verify/risk-tiers.yml", "scripts/delivery/hourly-report.mjs"]) {
      writeFileSync(f.calls, "");
      writeFileSync(f.files, `${path}\n`);
      f.tick("high");
      expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    }
    writeFileSync(f.calls, "");
    writeFileSync(f.files, "apps/api/app/api/restaurants/preview/route.ts\n");
    f.tick("high");
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test("two incomplete same-head reviews stop automatic retries and request coordination", () => {
  const f = fixture();
  try {
    const error = (id: number) => ({ context: "review/round", state: "error", description: "execution/timeout: independent review incomplete", id, created_at: `2026-09-28T00:00:0${id}Z` });
    writeFileSync(f.statuses, JSON.stringify([error(1)]));
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    writeFileSync(f.calls, "");
    writeFileSync(f.statuses, JSON.stringify([error(1), error(2)]));
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("");
    expect(readFileSync(f.posts, "utf8")).toContain("needs-coordinator");
    expect(readFileSync(f.posts, "utf8")).toContain("state=failure");
    const posts = readFileSync(f.posts, "utf8");
    writeFileSync(f.statuses, JSON.stringify([error(1), error(2), { ...error(3), state: "failure", description: "needs-coordinator: independent review requires diagnosed execution recovery" }]));
    f.tick();
    expect(readFileSync(f.posts, "utf8")).toBe(posts);
    writeFileSync(f.statuses, "not JSON");
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});


test.each(["authentication", "invalid_output", "process_error"])("%s does not trigger an automatic retry", kind => {
  const f = fixture();
  try {
    writeFileSync(f.statuses, JSON.stringify([{ context: "review/round", state: "error", id: 1,
      created_at: "2026-10-01T00:00:00Z", description: `execution/${kind}: independent review incomplete` }]));
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("");
    expect(readFileSync(f.posts, "utf8")).toContain("needs-coordinator");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});

test("poller uses the runner deadline and relaxes only one classified retry", () => {
  const f = fixture();
  try {
    f.tick();
    expect(readFileSync(f.calls + ".timeouts", "utf8")).toBe("900\n");
    writeFileSync(f.statuses, JSON.stringify([{ context: "review/round", state: "error", id: 1,
      created_at: "2026-10-01T00:00:00Z", description: "execution/timeout: independent review incomplete" }]));
    f.tick();
    expect(readFileSync(f.calls + ".timeouts", "utf8")).toBe("900\n1800\n");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});


test("separate legacy lens successes do not replace one complete round receipt", () => {
  const f = fixture();
  try {
    writeFileSync(f.files, "apps/api/lib/auth.ts\nscripts/review/poller.sh\n");
    writeFileSync(f.statuses, JSON.stringify(["correctness", "danger-zone", "workflow-security"].map((domain, id) => ({ context: `lens/${domain}`, state: "success", id, created_at: "2026-10-01T00:00:00Z" }))));
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
    expect(readFileSync(f.calls + ".timeouts", "utf8")).toBe("900\n");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});


test("same-head acceptance or harness identity changes invalidate a completed round", () => {
  const f = fixture();
  try {
    writeFileSync(f.statuses, JSON.stringify([{ context: "review/round", state: "success", id: 1, created_at: "2026-10-01T00:00:00Z", description: "round-key:fixture complete:pass" }]));
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("");
    writeFileSync(f.statuses, JSON.stringify([{ context: "review/round", state: "success", id: 1, created_at: "2026-10-01T00:00:00Z", description: "round-key:old-acceptance-or-harness complete:pass" }]));
    f.tick();
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});


test("changed-input old success is withdrawn before a denied replacement", () => {
  const f = fixture();
  try {
    writeFileSync(f.statuses, JSON.stringify([{ context: "review/round", state: "success", id: 1, created_at: "2026-10-01T00:00:00Z", description: "round-key:old complete:pass" }]));
    const runner = join(f.home, "repo/scripts/review/run-review.sh");
    writeFileSync(runner, readFileSync(runner, "utf8") + "exit 1\n");
    f.tick();
    const posts = readFileSync(f.posts, "utf8");
    expect(posts).toContain("state=pending");
    for (const context of ["lens/correctness", "lens/workflow-security", "review/round"]) expect(posts).toContain(`context=${context}`);
    expect(posts).not.toContain("state=success");
    expect(readFileSync(f.calls, "utf8")).toBe("review-round\n");
  } finally { rmSync(f.home, { recursive: true, force: true }); }
});
