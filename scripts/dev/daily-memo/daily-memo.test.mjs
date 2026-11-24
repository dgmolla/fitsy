import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const extract = input => spawnSync('bash', [resolve(here, 'extract-memo.sh')], { input, encoding: 'utf8' }).stdout;

test('progress chatter outside the memo tags is dropped and blank edges are trimmed', () => {
  const output = extract('The five transcript summaries are still running.\nGroup B is all no-op. Waiting on the other four.\n<memo>\n\n*Chunk*\n- a\n\n- b\n</memo>\nthanks\n');
  assert.equal(output, '*Chunk*\n- a\n\n- b\n');
});

test('output without tags is posted whole, NOTHING_HAPPENED survives, and empty input stays empty', () => {
  assert.equal(extract('*Chunk*\n- a\n'), '*Chunk*\n- a\n');
  assert.equal(extract('NOTHING_HAPPENED\n').trim(), 'NOTHING_HAPPENED');
  assert.equal(extract(''), '');
});

test('an unterminated memo tag keeps everything after it', () => {
  assert.equal(extract('chatter\n<memo>\n*Chunk*\n- a\n'), '*Chunk*\n- a\n');
});

test('the prompt heredoc renders without running any command and keeps the dash-bullet instruction', () => {
  const script = readFileSync(resolve(here, 'run.sh'), 'utf8');
  const start = script.indexOf('cat > "$PROMPT_FILE" <<EOF');
  const end = script.indexOf('\nEOF\n', start);
  assert.ok(start > 0 && end > start, 'prompt heredoc found');
  const dir = mkdtempSync(resolve(tmpdir(), 'daily-memo-'));
  const promptFile = resolve(dir, 'prompt.txt');
  try {
    const result = spawnSync('bash', ['-c', `LAST_RUN=a NOW=b CLAUDE_FILES_LIST=/x CURSOR_DUMP=/y PROMPT_FILE=${promptFile}\n${script.slice(start, end + 4)}`], { encoding: 'utf8' });
    assert.equal(result.stderr, '', 'no "command not found" from unescaped backticks');
    const prompt = readFileSync(promptFile, 'utf8');
    assert.match(prompt, /a `-` bulleted list/);
    assert.match(prompt, /<memo>\.\.\.<\/memo>/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the summarizer output is read as json and passed through the extractor', () => {
  const script = readFileSync(resolve(here, 'run.sh'), 'utf8');
  assert.match(script, /--output-format json/);
  assert.match(script, /jq -r '\.result \/\/ empty'.*extract-memo\.sh/);
});
