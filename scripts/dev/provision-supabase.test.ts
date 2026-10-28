import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DEV_PROJECT_REF, PROD_PROJECT_REF } from "../lib/db-target-guard";

const source = resolve(__dirname, "../..");
function drive(ref: string | undefined, runtimeRole = "fitsy_app") {
  const root = mkdtempSync(join(tmpdir(), "fitsy-provision-"));
  try {
    for (const path of ["scripts/dev/provision-supabase.sh", "scripts/dev/vercel-env-set.sh", "scripts/lib/db-target-guard.ts", "scripts/deploy/activate-runtime-role.ts"]) {
      mkdirSync(join(root, path, ".."), { recursive: true }); copyFileSync(join(source, path), join(root, path));
    }
    symlinkSync(join(source, "node_modules"), join(root, "node_modules"), "dir");
    mkdirSync(join(root, ".vercel"));
    writeFileSync(join(root, ".vercel/project.json"), JSON.stringify({ projectId: "fixture-project", orgId: "fixture-team" }));
    writeFileSync(join(root, 'database-transport.cjs'), `const Module=require('module'),original=Module._load;
Module._load=function(name,...args){if(name==='@prisma/client')return {PrismaClient:class{async $transaction(fn){return fn({$queryRaw:async()=>[], $executeRawUnsafe:async()=>0});}async $disconnect(){}}};return original.call(this,name,...args)};`);
    const bin = join(root, "bin"), calls = join(root, "calls.jsonl"); mkdirSync(bin); writeFileSync(calls, "");
    const realJq = spawnSync("which", ["jq"], { encoding: "utf8" }).stdout.trim();
    const commands: Record<string, string> = {
      // External CLI/HTTP boundaries only; both repository shell scripts and the guard execute unchanged.
      npx: `#!/bin/bash
set -eu
if [[ "$*" == *"projects api-keys"* ]]; then
  echo '{"operation":"supabase-keys"}' >> "$CALLS"
  echo '[{"name":"anon","api_key":"synthetic-anon"},{"name":"service_role","api_key":"synthetic-service"}]'
elif [[ "$*" == *"migrate"* ]]; then
  echo '{"operation":"prisma"}' >> "$CALLS"
fi
`,
      vercel: "#!/bin/bash\nexit 0\n",
      jq: `#!/bin/bash
set -eu
if [ "\${2:-}" = .token ]; then echo synthetic-token; else exec "$REAL_JQ" "$@"; fi
`,
      curl: `#!/usr/bin/env python3
import sys,os,json
args=sys.argv[1:]
if '-X' in args:
 method=args[args.index('-X')+1]
 body=json.loads(args[args.index('-d')+1]) if '-d' in args else {}
 with open(os.environ['CALLS'],'a') as f: print(json.dumps({'operation':'vercel-'+method,'key':body.get('key'),'target':body.get('target')}),file=f)
 print('{}')
else: print('{"envs":[]}')
`,
    };
    for (const [name, content] of Object.entries(commands)) { writeFileSync(join(bin, name), content); chmodSync(join(bin, name), 0o700); }
    const args = ref === undefined ? [] : ["--wire-only", ref, "synthetic-password"];
    const result = spawnSync("bash", ["scripts/dev/provision-supabase.sh", ...args], {
      cwd: root, encoding: "utf8", timeout: 15_000,
      env: { PATH: bin + ":" + process.env["PATH"], HOME: process.env["HOME"], CALLS: calls, REAL_JQ: realJq, SKIP_LOCAL_ENV: "1",
        SUPABASE_URL: `https://${DEV_PROJECT_REF}.supabase.co`,
        DEV_APP_DATABASE_URL: `postgresql://${runtimeRole}.${DEV_PROJECT_REF}:synthetic-runtime@aws-0-us-west-1.pooler.supabase.com:6543/postgres`,
        NODE_OPTIONS: `--require=${join(root, 'database-transport.cjs')}` },
    });
    return { status: result.status, output: result.stdout + result.stderr,
      calls: readFileSync(calls, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test.each([["production", PROD_PROJECT_REF], ["replacement", "abcdefghijklmnopqrst"], ["automatic creation", undefined]])("%s provisioning refuses before external access", (_label, ref) => {
  const result = drive(ref);
  expect(result.status).toBe(1);
  if (ref) expect(result.output).toMatch(/DB_WRITE_REFUSED|refusing/);
  expect(result.calls).toEqual([]);
  expect(result.output).not.toContain("synthetic-password");
});

test("allowlisted DEV provisioning still reaches its guarded migrations and only preview/development updates", () => {
  const result = drive(DEV_PROJECT_REF);
  expect(result.status).toBe(0);
  const updates = result.calls.filter(call => call.operation.startsWith("vercel-"));
  expect(updates.length).toBeGreaterThan(0);
  expect(updates.every(call => call.operation === "vercel-POST" && JSON.stringify(call.target) === '["preview","development"]')).toBe(true);
  expect(result.calls.filter(call => call.operation === "prisma")).toHaveLength(2);
  expect(result.output).not.toContain("synthetic-password");
});

test('DEV provisioning cannot publish administrator credentials as the runtime URL', () => {
  const result = drive(DEV_PROJECT_REF, 'postgres');
  expect(result.status).toBe(1);
  expect(result.calls).toEqual([]);
  expect(result.output).toContain('must use fitsy_app');
});
