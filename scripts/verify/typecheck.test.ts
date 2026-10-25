import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(__dirname, '../..');
const workspaces = ['apps/api', 'apps/mobile', 'packages/shared', 'scripts'];
let directory: string;

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'fitsy-typecheck-')));
  for (const path of ['scripts/verify', 'prisma', 'bin', ...workspaces]) mkdirSync(join(directory, path), { recursive: true });
  copyFileSync(join(root, 'scripts/verify/typecheck.sh'), join(directory, 'scripts/verify/typecheck.sh'));
  copyFileSync(join(root, 'prisma/schema.prisma'), join(directory, 'prisma/schema.prisma'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, workspaces }));
  for (const workspace of workspaces) {
    copyFileSync(join(root, workspace, 'package.json'), join(directory, workspace, 'package.json'));
    writeFileSync(join(directory, workspace, 'tsconfig.json'), '{}\n');
  }
  // External CLI boundaries model an installed client from an older schema.
  // The real package scripts and verifier must refresh it before compiling.
  writeFileSync(join(directory, 'bin/npx'), '#!/bin/sh\nexec "$@"\n', { mode: 0o755 });
  writeFileSync(join(directory, 'bin/prisma'), `#!/bin/sh
set -eu
printf 'generate:%s\\n' "$PWD" >> "$FITSY_TYPECHECK_LOG"
[ "$*" = 'generate --schema ../../prisma/schema.prisma' ] && [ -f "$3" ] || exit 99
[ "\${FITSY_TYPECHECK_GENERATE_EXIT:-0}" = 0 ] || exit "$FITSY_TYPECHECK_GENERATE_EXIT"
printf current > "$FITSY_TYPECHECK_CLIENT"
`, { mode: 0o755 });
  writeFileSync(join(directory, 'bin/tsc'), `#!/bin/sh
set -eu
[ "$*" = '--noEmit' ] || exit 98
workspace="\${PWD#"$FITSY_TYPECHECK_ROOT/"}"
printf 'tsc:%s\\n' "$workspace" >> "$FITSY_TYPECHECK_LOG"
if [ "$workspace" = apps/api ] && [ ! -f "$FITSY_TYPECHECK_CLIENT" ]; then
  echo "Property 'source' does not exist on type 'MacroTarget'" >&2
  exit 1
fi
case " \${FITSY_TYPECHECK_FAILURES:-} " in *" $workspace "*) exit 1;; esac
`, { mode: 0o755 });
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(extra: NodeJS.ProcessEnv = {}, direct = false) {
  const result = spawnSync(direct ? 'npm' : '/bin/bash', direct ? ['run', '--silent', 'type-check'] : ['scripts/verify/typecheck.sh'], {
    cwd: direct ? join(directory, 'apps/api') : directory, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      FITSY_TYPECHECK_ROOT: directory, FITSY_TYPECHECK_LOG: join(directory, 'commands.log'),
      FITSY_TYPECHECK_CLIENT: join(directory, 'current-client'), ...extra },
  });
  expect(result.error).toBeUndefined();
  return { ...result, commands: readFileSync(join(directory, 'commands.log'), 'utf8').trim().split('\n') };
}

test.each([false, true])('refreshes a stale Prisma client before compiling (direct API command: %s)', direct => {
  const result = run({}, direct);
  expect(result.status).toBe(0);
  expect(result.commands).toEqual([`generate:${join(directory, 'apps/api')}`,
    ...(direct ? ['apps/api'] : workspaces).map(workspace => `tsc:${workspace}`)]);
  if (!direct) expect(JSON.parse(result.stdout)).toMatchObject({ name: 'typecheck', status: 'pass' });
});

test.each([false, true])('generation failure prevents API compilation and remains blocking (direct: %s)', direct => {
  const result = run({ FITSY_TYPECHECK_GENERATE_EXIT: '7' }, direct);
  expect(result.status).not.toBe(0);
  expect(result.commands).toEqual([`generate:${join(directory, 'apps/api')}`,
    ...(direct ? [] : workspaces.slice(1).map(workspace => `tsc:${workspace}`))]);
  if (!direct) expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: 'type-check failed in: apps/api' });
});

test.each(['apps/api', 'apps/mobile packages/shared'])('real compiler failures remain blocking after generation: %s', failures => {
  const result = run({ FITSY_TYPECHECK_FAILURES: failures });
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: 'fail', summary: `type-check failed in: ${failures}` });
  expect(result.commands).toHaveLength(workspaces.length + 1);
});
