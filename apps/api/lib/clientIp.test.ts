import { NextRequest } from 'next/server';
import { trustedClientIp } from './clientIp';

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; });
const request = (headers: Record<string, string> = {}) => new NextRequest('https://api.example.test', { headers });

test('untrusted hosts ignore all forwarding headers, including Vercel lookalikes', () => {
  delete process.env['VERCEL'];
  delete process.env['VERCEL_ENV'];
  for (const headers of [{ 'x-forwarded-for': '192.0.2.1' }, { 'x-real-ip': '192.0.2.2' },
    { 'x-vercel-forwarded-for': '192.0.2.3', 'x-vercel-id': 'fake', host: 'app.vercel.app' }]) {
    expect(trustedClientIp(request(headers))).toBe('unknown');
  }
  process.env['VERCEL_ENV'] = 'production';
  expect(trustedClientIp(request({ 'x-vercel-forwarded-for': '192.0.2.3' }))).toBe('unknown');
  process.env['VERCEL'] = '1';
  process.env['VERCEL_ENV'] = 'development';
  expect(trustedClientIp(request({ 'x-vercel-forwarded-for': '192.0.2.3' }))).toBe('unknown');
});

test.each(['preview', 'production'])('trusts only the platform header in a Vercel %s deployment', environment => {
  process.env['VERCEL'] = '1';
  process.env['VERCEL_ENV'] = environment;
  expect(trustedClientIp(request({ 'x-vercel-forwarded-for': '192.0.2.1',
    'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' }))).toBe('192.0.2.1');
  expect(trustedClientIp(request({ 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2' }))).toBe('unknown');
});

test.each(['', 'not-an-ip', '192.0.2.1, 198.51.100.1', '192.0.2.1:80', '[::1]', 'fe80::1%en0'])('rejects ambiguous or invalid platform IP %j', value => {
  process.env['VERCEL'] = '1';
  process.env['VERCEL_ENV'] = 'production';
  expect(trustedClientIp(request({ 'x-vercel-forwarded-for': value, 'x-real-ip': '192.0.2.1' }))).toBe('unknown');
});

test.each([
  ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
  ['2001:db8::1', '2001:db8::1'], ['::ffff:192.0.2.1', '192.0.2.1'], ['::FFFF:c000:201', '192.0.2.1'],
])('canonicalizes %s', (value, expected) => {
  process.env['VERCEL'] = '1';
  process.env['VERCEL_ENV'] = 'production';
  expect(trustedClientIp(request({ 'x-vercel-forwarded-for': value }))).toBe(expected);
});
