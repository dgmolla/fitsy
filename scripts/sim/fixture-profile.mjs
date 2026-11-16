// #934: a previous run or a manual session can leave the shared dev fixture account with a blank profile, which makes every
// entitled flow land on onboarding right after Dev Login. Verify the baseline profile through the supported API before each
// flow and restore it when it is missing; fail with a clear message when it cannot be restored. Dev backends only.
import { execFileSync } from 'node:child_process';

// Values seeded for the entitled fixture (dev data only). Fixtures not listed here are left exactly as they are:
// onboarding flows on the unsubscribed and empty-store accounts need a profile that onboarding itself fills in.
export const baselineProfiles = {
  'entitled-dev': { goal: 'lose_fat', heightCm: 178, weightKg: 80,
    macroTarget: { calories: 595, proteinG: 49, carbsG: 57, fatG: 19, source: 'manual' } },
};

const allowedOrigin = origin => origin === 'https://dev.fitsy.org' || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
const complete = profile => Boolean(profile?.user?.goal && profile.user.heightCm && profile.user.weightKg && profile.macroTarget);

// Credentials and the bearer token travel on curl's stdin, never in process arguments.
export function curlJson(method, url, { token, body } = {}) {
  const config = [`url = ${JSON.stringify(url)}`, `request = ${method}`, 'silent', 'max-time = 20',
    'write-out = "\\n%{http_code}"', 'header = "Content-Type: application/json"'];
  if (token) config.push(`header = ${JSON.stringify(`Authorization: Bearer ${token}`)}`);
  if (body !== undefined) config.push(`data = ${JSON.stringify(JSON.stringify(body))}`);
  const output = execFileSync('curl', ['--config', '-'], { input: config.join('\n'), encoding: 'utf8', timeout: 30000 });
  const split = output.lastIndexOf('\n');
  let json = null;
  try { json = JSON.parse(output.slice(0, split)); } catch { /* non-JSON error body */ }
  return { status: Number(output.slice(split + 1)), json };
}

export function ensureBaselineProfile(fixture, http = curlJson) {
  const baseline = baselineProfiles[fixture?.name];
  if (!baseline) return 'not-applicable';
  const { EXPO_PUBLIC_API_URL: origin, EXPO_PUBLIC_DEV_LOGIN_EMAIL: email, EXPO_PUBLIC_DEV_LOGIN_PASSWORD: password } = fixture.env ?? {};
  const fail = reason => { throw new Error(`Fixture ${fixture.name}: ${reason}`); };
  if (!origin || !email || !password) fail('needs EXPO_PUBLIC_API_URL and its own dev login credentials to verify the profile');
  if (!allowedOrigin(origin)) fail('refusing to verify or restore a profile on a backend that is not the dev backend');
  const login = http('POST', `${origin}/api/auth/login`, { body: { email, password } });
  if (login.status !== 200 || !login.json?.token) fail(`dev login failed (HTTP ${login.status}); cannot verify the profile`);
  const token = login.json.token;
  const read = () => http('GET', `${origin}/api/user/profile`, { token });
  const first = read();
  if (first.status !== 200) fail(`profile read failed (HTTP ${first.status})`);
  if (complete(first.json)) return 'present';
  const restore = http('PATCH', `${origin}/api/user/profile`, { token, body: baseline });
  if (restore.status !== 200) fail(`profile is blank and the restore was rejected (HTTP ${restore.status})`);
  const second = read();
  if (second.status !== 200 || !complete(second.json)) fail('profile is still blank after the restore; entitled flows would land on onboarding');
  return 'restored';
}
