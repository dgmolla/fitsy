import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = resolve(__dirname, '../..');
let root: string;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(GIT_|FITSY_DIFF_|GITHUB_|CI$|FITSY_RUNS$|FITSY_LOCAL_DB$|FITSY_VERIFY_|POSTGRES_)/.test(key)));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, env, stdio: 'ignore' });
const cli = (...args: string[]) => spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs', ...args], { cwd: root, env, encoding: 'utf8', timeout: 30000 });
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fitsy-focused-'));
  mkdirSync(join(root, 'scripts/verify'), { recursive: true });
  for (const name of ['focused-tests.mjs', 'receipt-cache.mjs', 'impact-plan.mjs', 'python-focused.py', 'local-db.mjs', 'local-db-control.mjs', 'docker-runtime.mjs', 'node-focused-reporter.mjs']) copyFileSync(join(source, 'scripts/verify', name), join(root, 'scripts/verify', name));
  symlinkSync(join(source, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, '.gitignore'), 'node_modules\n.evidence/\n');
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, workspaces: ['scripts'] }));
  writeFileSync(join(root, 'scripts/package.json'), JSON.stringify({ name: '@fitsy/scripts', scripts: { test: 'jest --config=jest.config.cjs' } }));
  writeFileSync(join(root, 'scripts/jest.config.cjs'), 'module.exports = { testMatch: ["**/*.test.ts"], transform: {} };\n');
  writeFileSync(join(root, 'scripts/fixture.test.ts'), "test('fixture outcome', () => expect(2 + 2).toBe(4));\n");
  git('init', '-q'); git('config', 'user.name', 'Focused fixture'); git('config', 'user.email', 'fixture@example.test');
  git('add', '.'); git('commit', '-qm', 'baseline'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFileSync(join(root, 'scripts/candidate.ts'), 'export const changed = true;\n');
  git('add', 'scripts/candidate.ts'); git('commit', '-qm', 'candidate');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
test('persisted focused recipe executes real matching Jest tests and retains their results', () => {
  expect(cli('--set', 'scripts/fixture.test.ts', '--jest-pattern=fixture outcome').status).toBe(0);
  expect(cli().status).toBe(0);
  expect(JSON.parse(readFileSync(join(root, '.evidence/verify/focused-tests.json'), 'utf8'))).toMatchObject({ pattern: 'fixture outcome' });
});
test('missing or skipped focused selections cannot satisfy the cheap gate', () => {
  expect(cli().status).toBe(1);
  expect(cli('--set', 'scripts/fixture.test.ts', '--jest-pattern=absent outcome').status).toBe(0);
  const skipped = cli(); expect(skipped.status).toBe(1); expect(skipped.stdout).toContain('executed no passing tests');
});
test.each(['../outside.test.ts', '--runInBand', 'scripts/missing.test.ts'])('rejects unsupported or escaping test path %s', path => {
  expect(cli('--set', path).status).toBe(1);
});

test('focused Python imports preserve the frozen source without bytecode artifacts', () => {
  writeFileSync(join(root, 'scripts/focused_library.py'), 'value = 7\n');
  writeFileSync(join(root, 'scripts/fixture.test.py'), "import unittest\nimport focused_library\nclass Outcome(unittest.TestCase):\n def test_value(self): self.assertEqual(focused_library.value, 7)\n");
  expect(cli('--set', 'scripts/fixture.test.py').status).toBe(0);
  expect(cli().status).toBe(0);
  expect(existsSync(join(root, 'scripts/__pycache__'))).toBe(false);
});

test.each(["import unittest\nclass Outcome(unittest.TestCase):\n @unittest.expectedFailure\n def test_value(self): self.fail('known failure')\n", 'value = 7\n', "import unittest\n@unittest.skip('fixture')\nclass Outcome(unittest.TestCase):\n def test_value(self): pass\n"])('focused Python selection rejects zero executed passing tests', content => {
  writeFileSync(join(root, 'scripts/fixture.test.py'), content);
  expect(cli('--set', 'scripts/fixture.test.py').status).toBe(0);
  expect(cli().status).toBe(1);
});
test.each([undefined, 'postgresql://external.example/prod'])('direct API focused selection rejects unowned database %s', url => {
  mkdirSync(join(root, 'apps/api'), { recursive: true });
  writeFileSync(join(root, 'apps/api/fixture.test.ts'), "throw new Error('must not execute');\n");
  expect(cli('--set', 'apps/api/fixture.test.ts').status).toBe(0);
  const result = spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs'], { cwd: root, encoding: 'utf8', env: { ...env, FITSY_VERIFY_OWNED_DB: '', POSTGRES_PRISMA_URL: url, POSTGRES_URL_NON_POOLING: url } });
  expect(result.status).toBe(1);
  expect(result.stderr).not.toContain('must not execute');
});

test.each(['mjs', 'py'])('direct API focused %s rejects an external database before loading the file', extension => {
  mkdirSync(join(root, 'apps/api'), { recursive: true });
  const path = `apps/api/fixture.test.${extension}`;
  const content = extension === 'mjs'
    ? "import fs from 'node:fs'; import { test } from 'node:test'; fs.writeFileSync('.evidence/api-executed', 'unsafe'); test('outcome', () => {});\n"
    : "import pathlib, unittest\npathlib.Path('.evidence/api-executed').write_text('unsafe')\nclass Outcome(unittest.TestCase):\n def test_value(self): pass\n";
  writeFileSync(join(root, path), content);
  expect(cli('--set', path).status).toBe(0);
  const result = spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs'], { cwd: root, encoding: 'utf8', env: { ...env, FITSY_VERIFY_OWNED_DB: '', POSTGRES_PRISMA_URL: 'postgresql://external.example/prod', POSTGRES_URL_NON_POOLING: 'postgresql://external.example/prod' } });
  expect(existsSync(join(root, '.evidence/api-executed'))).toBe(false);
  expect(result.status).toBe(1);
});

test.each(['', "import { test } from 'node:test'; test('skip', {skip:true}, () => {});\n", "import { describe } from 'node:test'; describe('empty suite', () => {});\n"])('focused Node selection rejects empty or unexecuted cases', content => {
  writeFileSync(join(root, 'scripts/fixture.test.mjs'), content);
  expect(cli('--set', 'scripts/fixture.test.mjs').status).toBe(0);
  const result = cli(); expect(result.status).toBe(1); expect(result.stdout).toContain('executed no passing test cases');
});
test('focused Node selection retains counted real passing cases', () => {
  writeFileSync(join(root, 'scripts/fixture.test.mjs'), "import { test } from 'node:test'; test('real outcome', () => {});\n");
  expect(cli('--set', 'scripts/fixture.test.mjs').status).toBe(0);
  expect(cli().status).toBe(0);
});

test('unsupported shared Jest selection is rejected before persisting a broken recipe', () => {
  mkdirSync(join(root, 'packages/shared/src'), { recursive: true });
  writeFileSync(join(root, 'packages/shared/src/fixture.test.ts'), "test('shared outcome', () => {});\n");
  const result = cli('--set', 'packages/shared/src/fixture.test.ts');
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('unsupported focused test workspace');
  expect(existsSync(join(root, '.evidence/verify/focused-tests.json'))).toBe(false);
});

test.each(['ts', 'mjs', 'py'])('direct script focused %s rejects an external database before loading tests', extension => {
  const path = `scripts/fixture.test.${extension}`;
  const content = extension === 'py'
    ? "import pathlib, unittest\npathlib.Path('.evidence/script-executed').write_text('unsafe')\nclass Outcome(unittest.TestCase):\n def test_value(self): pass\n"
    : extension === 'mjs'
      ? "import fs from 'node:fs'; import { test } from 'node:test'; fs.writeFileSync('.evidence/script-executed', 'unsafe'); test('outcome', () => {});\n"
      : "require('node:fs').writeFileSync('.evidence/script-executed', 'unsafe'); test('outcome', () => {});\n";
  writeFileSync(join(root, path), content);
  expect(cli('--set', path).status).toBe(0);
  const result = spawnSync(process.execPath, ['scripts/verify/focused-tests.mjs'], { cwd: root, encoding: 'utf8', env: { ...env, FITSY_VERIFY_OWNED_DB: '', POSTGRES_PRISMA_URL: 'postgresql://external.example/prod', POSTGRES_URL_NON_POOLING: 'postgresql://external.example/prod' } });
  expect(existsSync(join(root, '.evidence/script-executed'))).toBe(false);
  expect(result.status).toBe(1);
});

// Keep run.mjs, focused-tests.mjs, test.sh and Jest real. Only database
// acquisition, independent review custody and unrelated test engines are external
// boundaries here; this fixture does not establish protected admission or DB proof.
type CallerEvent = { name: string; argv: string[]; env: Record<string, string> };
type ReceiptFault = 'missing' | 'failed' | 'expired' | 'environment' | 'report' | 'coverage' | 'old-invocation';
function focusedFullCallerFixture({ partial = false, build = false, fault, inheritedRecipe = false }: { partial?: boolean; build?: boolean; fault?: ReceiptFault; inheritedRecipe?: boolean } = {}) {
  for (const name of ['run.mjs', 'receipt-cache.mjs', 'focused-tests.sh', 'test.sh']) {
    copyFileSync(join(source, 'scripts/verify', name), join(root, 'scripts/verify', name));
  }
  writeFileSync(join(root, 'scripts/package.json'), JSON.stringify({ name: '@fitsy/scripts', scripts: { test: 'jest --config=jest.config.cjs' } }));
  writeFileSync(join(root, 'scripts/verify/registry.yml'), `checks:
  - name: focused-tests
    script: focused-tests.sh
    layer: 1
    cache: true
    blocking: true
    runs: [local]
  - name: review-admission
    script: review-admission.sh
    layer: 1
    preflight: true
    blocking: true
    runs: [local]
  - name: test
    script: test.sh
    layer: 2
    database: true
    cache: true
    blocking: true
    runs: [local, ci]
` + (build ? `  - name: build
    script: build.sh
    layer: 3
    blocking: true
    runs: [local]
` : ''));
  if (fault) {
    const registry = join(root, 'scripts/verify/registry.yml');
    writeFileSync(registry, readFileSync(registry, 'utf8').replace('  - name: test\n',
      '  - name: before-test\n    script: before-test.sh\n    layer: 2\n    blocking: true\n  - name: test\n'));
    writeFileSync(join(root, 'scripts/verify/before-test.sh'), '#!/bin/sh\nnode .evidence/before-test.mjs\n');
  }
  mkdirSync(join(root, 'bin'));
  mkdirSync(join(root, '.evidence'), { recursive: true });
  const quote = (value: string) => "'" + value.replace(/'/g, "'\"'\"'") + "'";
  const python = execFileSync('/usr/bin/which', ['python3'], { env, encoding: 'utf8' }).trim();
  const npm = execFileSync('/usr/bin/which', ['npm'], { env, encoding: 'utf8' }).trim();
  writeFileSync(join(root, 'bin/node'), `#!/bin/sh\nif [ "$1" = --test ]; then exit 0; fi\nexec ${quote(process.execPath)} "$@"\n`);
  writeFileSync(join(root, 'bin/python3'), `#!/bin/sh\ncase "$1" in scripts/*.py) exit 0 ;; esac\nexec ${quote(python)} "$@"\n`);
  const recordLaunch = `require('node:fs').appendFileSync('.evidence/launches.jsonl',JSON.stringify({argv:process.argv.slice(1),env:Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(FITSY_|POSTGRES_|NODE_OPTIONS)/.test(key)))})+'\\n');`;
  writeFileSync(join(root, 'bin/npm'), `#!/bin/sh\n${quote(process.execPath)} -e ${quote(recordLaunch)} "$@"\nexec ${quote(npm)} "$@"\n`);
  for (const name of ['node', 'python3', 'npm']) chmodSync(join(root, 'bin', name), 0o755);
  const childEnv = { ...env, PATH: `${join(root, 'bin')}:${env.PATH}`,
    ...(inheritedRecipe ? { FITSY_VERIFY_FOCUSED_RECIPE: 'inherited-caller-recipe' } : {}) };
  const assertion = (name: string) => `require('node:fs').appendFileSync(${JSON.stringify(join(root, '.evidence/assertions.jsonl'))}, JSON.stringify({name:${JSON.stringify(name)},argv:process.argv,env:Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(FITSY_|POSTGRES_|NODE_OPTIONS)/.test(key)))})+'\\n');`;
  writeFileSync(join(root, 'scripts/fixture.test.ts'), `test('complete file A', () => { ${assertion('A')} expect(2 + 2).toBe(4); });\ntest.skip('optional file A', () => {});\n` +
    (partial ? `test('unselected failure', () => { ${assertion('unselected')} expect(1).toBe(2); });\n` : ''));
  writeFileSync(join(root, 'scripts/residual.test.ts'), `test('residual file B', () => { ${assertion('B')} expect(3 + 3).toBe(6); });\n`);
  // The callback represents the existing lock owner's fresh preparation. Its
  // assertions remain mandatory at every actual producer/consumer boundary.
  writeFileSync(join(root, 'scripts/verify/local-db-control.mjs'), `import {appendFileSync} from 'node:fs';
export function assertOwnedDatabase(env=process.env) {
  if(env.FITSY_VERIFY_OWNED_DB!=='fixture-owned') throw Error('fixture database not prepared');
  appendFileSync('.evidence/boundaries.jsonl',JSON.stringify({event:'assert-db'})+'\\n');
}
export const assertPhaseLock=()=>{};
export const databaseControl=()=>{};
export const withOwnedLock=()=>{throw Error('unexpected DB lock acquisition')};
export const runWithLocalDatabase=()=>{throw Error('unexpected DB acquisition')};
`);
  writeFileSync(join(root, 'scripts/verify/review-admission.sh'), `#!/bin/bash\nset -eu\nexec ${quote(python)} .evidence/admission.py\n`);
  if (build) writeFileSync(join(root, 'scripts/verify/build.sh'), `#!/bin/bash\nset -eu\n[ -z "\${POSTGRES_PRISMA_URL:-}\${POSTGRES_URL_NON_POOLING:-}\${FITSY_VERIFY_OWNED_DB:-}" ]\nprintf '%s\\n' '{"event":"build"}' >> .evidence/boundaries.jsonl\nprintf '%s\\n' '{"status":"pass"}'\n`);
  git('add', '.'); git('commit', '-qm', 'real caller fixture baseline');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const base = execFileSync('git', ['rev-parse', 'origin/main'], { cwd: root, env, encoding: 'utf8' }).trim();
  writeFileSync(join(root, 'scripts/candidate.ts'), 'export const changed = "focused/full";\n');
  // Exercise the exact adapter function called by protected review-admission,
  // including its fixed cheap argv and real frozen-source rechecks. Synthetic
  // custody is a test boundary, never authority to use an installed operator.
  writeFileSync(join(root, '.evidence/admission.py'), `import importlib.util,json,os,pathlib,sys
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('approval',${JSON.stringify(join(source, 'scripts/review/external-approval.py'))})
approval=importlib.util.module_from_spec(spec);spec.loader.exec_module(approval)
root=pathlib.Path(${JSON.stringify(root)})
source=approval.subprocess.check_output(['git','rev-parse','HEAD'],cwd=root).decode().strip()
config={'operator_uid':os.getuid(),'candidate_boundary':{'issue':458,'source_sha':source,'comparison_base':${JSON.stringify(base)},'launcher_path':str(root/'.evidence/launcher.sh')}}
with patch.object(approval,'candidate_custody',return_value={'worktree':str(root)}):
 code=approval.candidate_checks(config,458,source,${JSON.stringify(base)},str(root),'cheap')
print(json.dumps({'name':'review-admission','status':'pass' if code==0 else 'fail'}))
sys.exit(code)
`);
  writeFileSync(join(root, '.evidence/launcher.sh'), `#!/bin/bash\nset -eu\n[ "$1" = --candidate-command ]\nshift\nexec /usr/bin/env -i ${Object.entries(childEnv).filter((entry): entry is [string, string] => entry[1] !== undefined).map(([key, value]) => quote(key + '=' + value)).join(' ')} "$@"\n`);
  if (fault) writeFileSync(join(root, '.evidence/before-test.mjs'), `import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
const file='.evidence/verify/check-cache/focused-tests.json';
const receipt=JSON.parse(readFileSync(file,'utf8'));
const fault=${JSON.stringify(fault)};
if(fault==='missing') unlinkSync(file);
else {
 if(fault==='failed') receipt.result.status='fail';
 if(fault==='expired') receipt.finishedAt=0;
 if(fault==='environment') receipt.environment='different-child-environment';
 if(fault==='old-invocation') receipt.result.invocation_pid=0;
 if(fault==='report') writeFileSync(receipt.result.whole_files[0].report,'tampered');
 if(fault==='coverage') {
  const path=receipt.result.whole_files[0].report;
  const report=JSON.parse(readFileSync(path,'utf8'));report.coverageMap={};
  const raw=JSON.stringify(report);writeFileSync(path,raw);
  for(const proof of receipt.result.whole_files) proof.sha256=createHash('sha256').update(raw).digest('hex');
 }
 writeFileSync(file,JSON.stringify(receipt));
}
console.log(JSON.stringify({status:'pass'}));
`);
  writeFileSync(join(root, '.evidence/full.mjs'), `import {appendFileSync} from 'node:fs';
import {verify} from '../scripts/verify/run.mjs';
process.exitCode=await verify(['--layer=${build ? 'all' : '0-2'}','--stage=full','--scope=changed','--runs=local','--reuse','--base=${base}'],()=>{
 appendFileSync('.evidence/boundaries.jsonl',JSON.stringify({event:'prepare-db'})+'\\n');
 return {FITSY_VERIFY_OWNED_DB:'fixture-owned',POSTGRES_PRISMA_URL:'postgresql://fixture-owned/epoch-one',POSTGRES_URL_NON_POOLING:'postgresql://fixture-owned/epoch-one'};
});
`);
  mkdirSync(join(root, '.evidence/delivery'), { recursive: true });
  writeFileSync(join(root, '.evidence/delivery/binding.json'), JSON.stringify({ issue: 458 }));
  expect(cli('--set', 'scripts/fixture.test.ts', ...(partial ? ['--jest-pattern=complete file A'] : [])).status).toBe(0);
  git('add', '.'); git('commit', '-qm', 'real focused and full caller fixture');
  return {
    run: () => spawnSync(process.execPath, ['.evidence/full.mjs'], { cwd: root, env: childEnv, encoding: 'utf8', timeout: 30000 }),
    runCi: () => spawnSync(process.execPath, ['scripts/verify/run.mjs', '--layer=0-2', '--scope=changed', '--runs=ci', `--base=${base}`], { cwd: root, env: { ...childEnv, CI: 'true' }, encoding: 'utf8', timeout: 30000 }),
    runDirect: () => spawnSync('/bin/bash', ['-p', 'scripts/verify/test.sh', '--scope=changed', `--base=${base}`], { cwd: root, env: { ...childEnv, FITSY_RUNS: 'local' }, encoding: 'utf8', timeout: 30000 }),
    events: () => readFileSync(join(root, '.evidence/assertions.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as CallerEvent),
    launches: () => readFileSync(join(root, '.evidence/launches.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as Omit<CallerEvent, 'name'>),
  };
}

test('canonical full caller reuses a complete focused file while nested admission and residual Jest remain real', () => {
  const fixture = focusedFullCallerFixture();
  const result = fixture.run();
  const events = fixture.events();
  const launches = fixture.launches();
  console.info('FOCUSED_FULL_CALLER_TRACE', JSON.stringify({ status: result.status, stdout: result.stdout, stderr: result.stderr, events,
    launches, boundaries: readFileSync(join(root, '.evidence/boundaries.jsonl'), 'utf8') }));
  expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' });
  // Protected admission has a genuinely different cheap context. It must keep
  // its own A assertion, while the full-context producer covers exactly A once.
  expect(events.filter(event => event.name === 'A' && event.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned')).toHaveLength(1);
  expect(events.filter(event => event.name === 'A' && !event.env.FITSY_VERIFY_OWNED_DB)).toHaveLength(1);
  expect(events.find(event => event.name === 'A' && !event.env.FITSY_VERIFY_OWNED_DB)?.env.FITSY_VERIFY_NEEDS_TEST_DEPS).toBe('0');
  const fullContextLaunches = launches.filter(launch => launch.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned');
  expect(fullContextLaunches).toHaveLength(2);
  expect(fullContextLaunches[0]?.argv).toContain('--runTestsByPath');
  expect(fullContextLaunches[1]?.argv.some(arg => arg.startsWith('--testPathIgnorePatterns='))).toBe(true);
  for (const launch of fullContextLaunches) {
    expect(launch.argv.slice(0, 5)).toEqual(['test', '--workspace=@fitsy/scripts', '--', '--maxWorkers=1', '--workerIdleMemoryLimit=256MB']);
    expect(launch.env).toMatchObject({ FITSY_MEDIA_INTEGRATION: '0', NODE_OPTIONS: '--max-old-space-size=512' });
  }
  expect(events.find(event => event.name === 'A' && event.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned')?.env)
    .toEqual(events.find(event => event.name === 'B')?.env);
  expect(events.filter(event => event.name === 'B')).toHaveLength(1);
  expect(result.stdout).toContain('"name":"test","status":"pass"');
}, 45000);

test('canonical full caller strips inherited recipe transport from both Jest children before reuse', () => {
  const fixture = focusedFullCallerFixture({ inheritedRecipe: true });
  const result = fixture.run();
  const events = fixture.events();
  const launches = fixture.launches();
  console.info('FOCUSED_FULL_INHERITED_RECIPE_TRACE', JSON.stringify({ status: result.status, stdout: result.stdout,
    stderr: result.stderr, events, launches }));
  expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' });
  const fullContextLaunches = launches.filter(launch => launch.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned');
  expect(fullContextLaunches).toHaveLength(2);
  for (const launch of fullContextLaunches) expect(launch.env).not.toHaveProperty('FITSY_VERIFY_FOCUSED_RECIPE');
  expect(fullContextLaunches[1]?.argv.some(arg => arg.startsWith('--testPathIgnorePatterns='))).toBe(true);
  expect(events.filter(event => event.name === 'A' && event.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned')).toHaveLength(1);
  expect(events.filter(event => event.name === 'A' && !event.env.FITSY_VERIFY_OWNED_DB)).toHaveLength(1);
  expect(events.filter(event => event.name === 'B')).toHaveLength(1);
  expect(events.find(event => event.name === 'A' && event.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned')?.env)
    .toEqual(events.find(event => event.name === 'B')?.env);
}, 45000);

test('canonical full caller retains unselected failing assertions from a partial focused pattern', () => {
  const fixture = focusedFullCallerFixture({ partial: true });
  const result = fixture.run();
  const events = fixture.events();
  expect(result.status).toBe(1);
  expect(result.stdout).toContain('"name":"test","status":"fail"');
  expect(events.filter(event => event.name === 'A' && event.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned')).toHaveLength(2);
  expect(events.filter(event => event.name === 'unselected')).toHaveLength(1);
  expect(events.filter(event => event.name === 'B')).toHaveLength(1);
  expect(fixture.launches().at(-1)?.argv.some(arg => arg.startsWith('--testPathIgnorePatterns='))).toBe(false);
}, 45000);

test('canonical full caller keeps the database-free build before acquisition and full-context focus', () => {
  const fixture = focusedFullCallerFixture({ build: true });
  const result = fixture.run();
  expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' });
  const boundaries = readFileSync(join(root, '.evidence/boundaries.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).event);
  expect(boundaries.slice(0, 2)).toEqual(['build', 'prepare-db']);
  expect(fixture.events().filter(event => event.name === 'A' && event.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned')).toHaveLength(1);
  expect(fixture.events().filter(event => event.name === 'B')).toHaveLength(1);
}, 45000);

test.each<ReceiptFault>(['missing', 'failed', 'expired', 'environment', 'report', 'coverage', 'old-invocation'])(
  'canonical full caller reruns complete files when focused proof is %s', fault => {
    const fixture = focusedFullCallerFixture({ fault });
    const result = fixture.run();
    expect({ status: result.status, stderr: result.status === 0 ? '' : result.stderr }).toEqual({ status: 0, stderr: '' });
    expect(fixture.events().filter(event => event.name === 'A' && event.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned')).toHaveLength(2);
    expect(fixture.events().filter(event => event.name === 'B')).toHaveLength(1);
    expect(fixture.launches().at(-1)?.argv.some(arg => arg.startsWith('--testPathIgnorePatterns='))).toBe(false);
  }, 45000);

test('canonical CI and direct full callers execute every file independently of local focused proof', () => {
  const fixture = focusedFullCallerFixture();
  expect(fixture.run().status).toBe(0);
  let before = fixture.events().length;
  expect(fixture.runDirect().status).toBe(0);
  expect(fixture.events().slice(before).map(event => event.name).sort()).toEqual(['A', 'B']);
  before = fixture.events().length;
  expect(fixture.runCi().status).toBe(0);
  expect(fixture.events().slice(before).map(event => event.name).sort()).toEqual(['A', 'B']);
  expect(fixture.launches().at(-1)?.argv.some(arg => arg.startsWith('--testPathIgnorePatterns='))).toBe(false);
}, 45000);

test('canonical repeated full invocations freshly execute database-context focus and residual tests', () => {
  const fixture = focusedFullCallerFixture();
  expect(fixture.run().status).toBe(0);
  const before = fixture.events().length;
  expect(fixture.run().status).toBe(0);
  const events = fixture.events().slice(before);
  expect(events.filter(event => event.name === 'A' && event.env.FITSY_VERIFY_OWNED_DB === 'fixture-owned')).toHaveLength(1);
  expect(events.filter(event => event.name === 'B')).toHaveLength(1);
  expect(readFileSync(join(root, '.evidence/boundaries.jsonl'), 'utf8').match(/prepare-db/g)).toHaveLength(2);
}, 45000);
