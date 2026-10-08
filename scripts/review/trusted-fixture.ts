import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Disposable repositories install only their own committed main as fixture trust.
export function installFixtureHarness(root: string, env: NodeJS.ProcessEnv, home: string) {
  const external = join(home, "trusted-local");
  rmSync(external, { recursive: true, force: true });
  mkdirSync(external, { recursive: true });
  const archive = execFileSync("git", ["archive", "origin/main"], { cwd: root, env });
  execFileSync("tar", ["-x", "-C", external], { input: archive });
  if (!existsSync(join(home, "provenance-private.pem"))) execFileSync("openssl", ["genrsa", "-out", join(home, "provenance-private.pem"), "2048"], { stdio: "ignore" });
  execFileSync("openssl", ["rsa", "-in", join(home, "provenance-private.pem"), "-pubout", "-out", join(home, "provenance-public.pem")], { stdio: "ignore" });
  return external;
}

export function prepareTrustedFixture(root: string, source: string) {
  mkdirSync(join(root, "scripts/delivery"), { recursive: true });
  cpSync(join(source, "scripts/delivery/phase-events.mjs"), join(root, "scripts/delivery/phase-events.mjs"));
  for (const domain of ["docs-sanity", "danger-zone"]) writeFileSync(join(root, `.claude/lenses/${domain}.md`), `Review ${domain}.\n`);
}

export function fixtureGit(root: string, env: NodeJS.ProcessEnv, args: string[]) {
  const value = execFileSync("git", args, { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (args[0] === "update-ref" && args[1] === "refs/remotes/origin/main" && existsSync(join(root, "old-poller/trusted-local"))) installFixtureHarness(root, env, join(root, "old-poller"));
  return value;
}
