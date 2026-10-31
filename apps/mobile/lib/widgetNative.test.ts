import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('runs the Expo target wiring and executable native widget regressions', () => {
  const result = execFileSync(process.execPath, ['--test', '--test-reporter=tap', resolve(__dirname, '../plugins/widget.test.cjs')], {
    encoding: 'utf8', timeout: 180_000,
  });
  expect(result).toMatch(/# fail 0/);
  expect(result).toMatch(process.platform === 'darwin' ? /# pass 6/ : /# pass 1/);
}, 185_000);
