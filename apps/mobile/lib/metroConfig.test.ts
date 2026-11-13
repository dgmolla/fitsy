import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

test('the actual Metro caller keeps Sentry Replay exclusion and existing native module pins', () => {
  const result = execFileSync(process.execPath, ['-e', `
    const config = require('./metro.config.js');
    const context = { resolveRequest: (_context, name) => ({ type: 'sourceFile', filePath: name }) };
    const resolve = name => config.resolver.resolveRequest(context, name, 'ios');
    process.stdout.write(JSON.stringify({
      replay: resolve('@sentry-internal/replay'),
      canvas: resolve('@sentry-internal/replay-canvas'),
      screens: resolve('react-native-screens'),
      ordinary: resolve('expo-font'),
    }));
  `], { cwd: resolve(__dirname, '..'), encoding: 'utf8' });
  const resolutions = JSON.parse(result);
  expect(resolutions.replay).toEqual({ type: 'empty' });
  expect(resolutions.canvas).toEqual({ type: 'empty' });
  expect(resolutions.screens.filePath).toBe(resolve(__dirname, '../node_modules/react-native-screens'));
  expect(resolutions.ordinary).toEqual({ type: 'sourceFile', filePath: 'expo-font' });
});
