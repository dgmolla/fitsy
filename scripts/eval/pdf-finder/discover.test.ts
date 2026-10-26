import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discover, domainOf, onDomain, scoreCandidate } from './discover';
import { searchLinks } from './html';
import { publicUrl, type WebFetch } from './fetch';
import type { Candidate } from './types';

const candidate = (url: string): Candidate => ({ url, title: 'Nutrition', discoveredFrom: [{ url: 'https://html.duckduckgo.com/', kind: 'search' }], reasons: [], official: false, score: 0, outcome: '' });

test('unwraps DDG HTML, lite, and Bing result links without following trackers or ads', async () => {
  const html = await readFile(join(__dirname, 'fixtures/search.html'), 'utf8');
  expect(searchLinks(html, 'https://html.duckduckgo.com/').map(row => row.url)).toEqual([
    'https://chain.example.org/nutrition.pdf?v=2', 'https://other.example.org/chain', 'https://chain.example.org/nutrition',
  ]);
});

test('domain boundaries and explicit official links control source preference', () => {
  expect(domainOf('https://www.chain.example.org')).toBe('chain.example.org');
  expect(onDomain('https://cdn.chain.example.org/info', 'chain.example.org')).toBe(true);
  expect(onDomain('https://chain.example.org.evil.org/info', 'chain.example.org')).toBe(false);
  const official = scoreCandidate(candidate('https://chain.example.org/nutrition.pdf'), 'chain.example.org', 'Chain');
  const other = scoreCandidate(candidate('https://other.example.org/chain/nutrition.pdf'), 'chain.example.org', 'Chain');
  expect(official.official).toBe(true);
  expect(other.official).toBe(false);
  const current = candidate('https://cdn.example.org/latest.pdf');
  current.discoveredFrom = [{ url: 'https://chain.example.org/nutrition/', kind: 'official-link' }];
  expect(scoreCandidate(current, 'chain.example.org', 'Chain').score).toBeGreaterThan(official.score);
});

test.each(['file:///etc/passwd', 'https://user:password@example.org/', 'http://127.0.0.1/', 'http://[::1]/',
  'http://localhost/', 'http://service.local/', 'https://example.org:8443/'])('rejects unsupported website URL %s', url => {
  expect(() => publicUrl(url)).toThrow('public HTTP(S)');
});

test('live discovery entrypoint records challenge recovery and prefers the current official link', async () => {
  const out = await mkdtemp(join(tmpdir(), 'pdf-discovery-'));
  await mkdir(join(out, 'search')); await mkdir(join(out, 'downloads'));
  const responses: Record<string, string> = {
    'https://chain.example.org/old-nutrition.pdf': '%PDF-old',
    'https://www.chain.example.org/': '<a href="/nutrition/">Nutrition</a>',
    'https://www.chain.example.org/nutrition/': '<noscript><a href="https://assets.example.org/current.pdf">Nutrition PDF</a></noscript>',
  };
  const requested: string[] = [];
  const get: WebFetch = async url => {
    requested.push(url);
    const html = url.startsWith('https://html.duckduckgo.com') ? '<html>Challenge</html>'
      : url.startsWith('https://lite.duckduckgo.com') ? '<a class="result-link" href="https://chain.example.org/old-nutrition.pdf">Old nutrition PDF</a>'
      : responses[url];
    if (html === undefined) throw new Error(`Unexpected fetch: ${url}`);
    return { url, status: 200, bytes: Buffer.from(html), contentType: 'text/html' };
  };
  try {
    const { discovery } = await discover('Chain', 'chain.example.org', out, get);
    expect(discovery.searches).toHaveLength(2);
    expect(discovery.searches[0]!.outcome).toContain('challenge');
    expect(discovery.candidates[0]!.url).toBe('https://assets.example.org/current.pdf');
    expect(discovery.candidates[0]!.reasons).toContain('Current official-page link outranks search-only documents.');
    expect(requested).not.toContain('https://www.bing.com/search');
  } finally { await rm(out, { recursive: true, force: true }); }
});
