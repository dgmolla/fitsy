// Read only this invocation's fresh test-engine output, never a saved pass.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function passingTests(file, engine) {
  const raw = readFileSync(file, 'utf8').trim();
  const result = JSON.parse(engine === 'node' ? raw.split('\n').at(-1) : raw);
  const count = engine === 'jest' ? result.numPassedTests : result.passing_tests;
  if (!['jest', 'node', 'python'].includes(engine) ||
      (engine !== 'node' && !result.success) ||
      !Number.isSafeInteger(count) || count <= 0) {
    throw new Error(`${engine} selection executed no passing tests or failed`);
  }
  return count;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { passingTests(process.argv[2], process.argv[3]); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
