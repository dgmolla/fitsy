import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('review executor enforces provider, process and output boundaries', () => {
  expect(() => execFileSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', 'scripts/review', '-p', 'test_execute_review.py'], {
    cwd: resolve(__dirname, '../..'), encoding: 'utf8', stdio: 'pipe', timeout: 20_000,
  })).not.toThrow();
}, 25_000);
