import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Disposable repositories install only their own committed main as fixture trust.
export function installFixtureHarness(root: string, env: NodeJS.ProcessEnv, home: string) {
  const external = join(home, "trusted-local");
  mkdirSync(external, { recursive: true });
  const archive = execFileSync("git", ["archive", "origin/main"], { cwd: root, env });
  execFileSync("tar", ["-x", "-C", external], { input: archive });
  execFileSync("openssl", ["genrsa", "-out", join(home, "provenance-private.pem"), "2048"], { stdio: "ignore" });
  execFileSync("openssl", ["rsa", "-in", join(home, "provenance-private.pem"), "-pubout", "-out", join(home, "provenance-public.pem")], { stdio: "ignore" });
  return external;
}
