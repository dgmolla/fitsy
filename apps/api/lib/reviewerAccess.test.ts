import { isDevelopmentEnvironment } from '../services/runtimeEnvironment';
import { canRegisterWithPassword, canUsePasswordLogin } from './reviewerAccess';

const originalEnv = process.env;
afterEach(() => { process.env = originalEnv; });

test.each([
  [{ NODE_ENV: 'production' }, false], [{}, false],
  [{ NODE_ENV: 'production', VERCEL_ENV: 'preview' }, true],
  [{ NODE_ENV: 'development' }, true], [{ NODE_ENV: 'test' }, true],
  [{ NODE_ENV: 'test', VERCEL_ENV: 'production' }, false],
  [{ VERCEL_ENV: 'preview', SUPABASE_URL: 'https://zaxkmjqozvmbifiwbxps.supabase.co' }, false],
])('password auth fails closed for deployment %j', (env, allowed) => {
  process.env = { ...env } as NodeJS.ProcessEnv;
  expect(isDevelopmentEnvironment()).toBe(allowed);
  expect(canRegisterWithPassword()).toBe(allowed);
  expect(canUsePasswordLogin('ordinary@example.test')).toBe(allowed);
  expect(canUsePasswordLogin(' APPREVIEW@FITSY.ORG ')).toBe(true);
});
