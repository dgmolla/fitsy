import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

function runPython(args: string[]) {
  return spawnSync('python3', ['-B', join(__dirname, 'routine-release.test.py'), ...args], {
    encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
}

const discovery = runPython(['--list-tests']);
if (discovery.error || discovery.status !== 0) {
  throw new Error(`Release test discovery failed: ${discovery.error?.message ?? discovery.stderr}`);
}
const cases: string[] = JSON.parse(discovery.stdout);
if (!Array.isArray(cases) || !cases.length || cases.some(name => typeof name !== 'string')) {
  throw new Error('Release test discovery must return a nonempty list of case names');
}

// CI exhausted one aggregate deadline after 42 passing cases. Bound each real
// unittest case independently so added coverage does not consume earlier cases' time.
test.each(cases)('automatic release guards: %s', name => {
  const result = runPython([name]);
  expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({
    status: 0, stderr: expect.stringContaining('OK'), error: undefined,
  });
}, 95_000);
