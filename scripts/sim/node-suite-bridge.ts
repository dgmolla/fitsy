import { execFileSync } from 'node:child_process';

export function requireNodeSuite(file: string, expectedTests?: number) {
  let output: string;
  try {
    output = execFileSync(process.execPath, ['--test', '--test-reporter=tap', file],
      { encoding: 'utf8', timeout: 60_000, env: { ...process.env, NODE_OPTIONS: '' } });
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; status?: number; signal?: string };
    throw new Error(`Node suite process failed (${failure.status ?? failure.signal ?? 'unknown'}): ${file}\n${failure.stdout || ''}\n${failure.stderr || ''}`);
  }
  requirePassingNodeSummary(output, file);
  if (expectedTests !== undefined) {
    const actual = Number(output.match(/^# tests (\d+)$/m)?.[1] ?? -1);
    if (actual !== expectedTests) throw new Error(`Expected ${expectedTests} required Node tests, found ${actual}: ${file}`);
  }
}

export function requirePassingNodeSummary(output: string, file: string) {
  const count = (kind: string) => Number(output.match(new RegExp(`^# ${kind} (\\d+)$`, 'm'))?.[1] ?? -1);
  const tests = count('tests');
  if (tests < 1 || count('pass') !== tests || count('fail') !== 0 ||
      count('cancelled') !== 0 || count('skipped') !== 0) {
    throw new Error(`Node suite did not report all required tests passing: ${file}`);
  }
}
