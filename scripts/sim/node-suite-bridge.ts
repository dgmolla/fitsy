import { execFileSync } from 'node:child_process';

export function requireNodeSuite(file: string) {
  const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', file],
    { encoding: 'utf8', timeout: 60_000, env: { ...process.env, NODE_OPTIONS: '' } });
  requirePassingNodeSummary(output, file);
}

export function requirePassingNodeSummary(output: string, file: string) {
  const count = (kind: string) => Number(output.match(new RegExp(`^# ${kind} (\\d+)$`, 'm'))?.[1] ?? -1);
  const tests = count('tests');
  if (tests < 1 || count('pass') !== tests || count('fail') !== 0 ||
      count('cancelled') !== 0 || count('skipped') !== 0) {
    throw new Error(`Node suite did not report all required tests passing: ${file}`);
  }
}
