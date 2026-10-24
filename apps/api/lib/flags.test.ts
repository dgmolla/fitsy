import { isFlagEnabled } from './flags';

const originalEnv = process.env;
beforeEach(() => { process.env = { ...originalEnv }; delete process.env.FLAG_TEST; });
afterEach(() => { process.env = originalEnv; });

test.each([undefined, '', 'false', '0', '1', 'TRUE', ' true ', 'true'])('FLAG_TEST=%s is default OFF, with an explicit true opt-in', value => {
  if (value !== undefined) process.env.FLAG_TEST = value;
  expect(isFlagEnabled('TEST')).toBe(value === 'true');
  expect(isFlagEnabled('UNKNOWN')).toBe(false);
});

test('rejects invalid flag names', () => {
  process.env.FLAG_bad = 'true';
  expect(isFlagEnabled('bad')).toBe(false);
});
