import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { parseHtml, parsePdfText } from './parse';
import type { Extraction } from './types';

const execute = promisify(execFile);

export async function extract(file: string): Promise<Extraction> {
  const bytes = await readFile(file);
  if (bytes.subarray(0, 5).toString() !== '%PDF-') {
    const html = bytes.toString('utf8');
    if (!/<(?:!doctype|html|table|article|ul|div)\b/i.test(html)) throw new Error('Source is neither PDF nor supported HTML.');
    return parseHtml(html);
  }
  try {
    const { stdout } = await execute('pdftotext', ['-layout', '-enc', 'UTF-8', file, '-'], {
      encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
    });
    return parsePdfText(stdout);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'ENOENT') throw new Error('pdftotext is unavailable. Install Poppler (brew install poppler), or use an official HTML table/page. No Node PDF library exists in this checkout.');
    throw new Error(`PDF text extraction failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
