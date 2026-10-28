import { parseRetryAfter, parseUeRateOptions, validateUeRate } from './ue-rate-limiter';

test('the shared cap is explicit, bounded and independent of run or worker settings', () => {
  expect(parseUeRateOptions(['ue-rate'])).toBeUndefined();
  expect(parseUeRateOptions(['ue-rate', '--requests-per-second=0.5'])).toBe(0.5);
  expect([0.01, 1, 10].map(validateUeRate)).toEqual([0.01, 1, 10]);
});
test.each([0, -1, 0.009, 10.01, NaN, Infinity])('unsafe caps are refused: %s', rate => {
  expect(() => validateUeRate(rate)).toThrow('UE rate must be');
});
test.each([
  ['ue-rate', '--requests-per-second='], ['ue-rate', '--requests-per-second=NaN'],
  ['ue-rate', '--requests-per-second=2', '--requests-per-second=1'],
  ['ue-rate', '--run-id=test'], ['ue-rate', '--requests-per-second=0'],
  ['worker', '--requests-per-second=1'],
])('invalid rate commands fail before connecting: %j', (...args) => {
  expect(() => parseUeRateOptions(args)).toThrow();
});
test('Retry-After supports relative seconds and absolute HTTP dates without worker-clock arithmetic', () => {
  expect(parseRetryAfter(' 120 ')).toEqual({ delayMs: 120_000, at: null });
  expect(parseRetryAfter('0.5')).toEqual({ delayMs: 500, at: null });
  expect(parseRetryAfter('Wed, 28 Oct 2026 12:00:00 GMT')).toEqual({ delayMs: 0, at: new Date('2026-10-28T12:00:00Z') });
  expect(parseRetryAfter('9'.repeat(400)).delayMs).toBe(365 * 24 * 60 * 60_000);
});
test.each([null, '', '-1', 'NaN', 'Infinity', 'nonsense', '1.2.3', 'Wed, invalid'])('invalid Retry-After falls back to the shared minimum: %s', value => {
  expect(parseRetryAfter(value)).toEqual({ delayMs: 0, at: null });
});
