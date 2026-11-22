import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const config = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf8'));
const headerValue = (rule: { headers: { key: string; value: string }[] }, key: string) => rule.headers.find(item => item.key === key)?.value;

// #1029: the ZAP baseline on dev.fitsy.org found document responses without clickjacking, sniffing or CSP protection.
test('public website documents carry anti-clickjacking, nosniff and CSP headers, and the API is excluded', () => {
  const rule = config.headers.find((item: { source: string }) => item.source === '/((?!api/).*)');
  expect(rule).toBeDefined();
  expect(headerValue(rule, 'X-Frame-Options')).toBe('DENY');
  expect(headerValue(rule, 'X-Content-Type-Options')).toBe('nosniff');
  expect(headerValue(rule, 'Content-Security-Policy')).toBe("frame-ancestors 'none'");
  expect(headerValue(rule, 'Content-Security-Policy-Report-Only')).toContain("object-src 'none'");
  expect(new RegExp(`^${rule.source}$`).test('/api/health')).toBe(false);
  expect(new RegExp(`^${rule.source}$`).test('/support')).toBe(true);
});

test('robots.txt hides the API and links the sitemap', () => {
  const robots = readFileSync(resolve(root, 'apps/api/public/robots.txt'), 'utf8');
  expect(robots).toContain('Disallow: /api/');
  expect(robots).toContain('Sitemap: https://fitsy.org/sitemap.xml');
});
