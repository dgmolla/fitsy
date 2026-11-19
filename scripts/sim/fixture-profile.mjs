// #934: a previous run or a manual session can leave a shared dev fixture account in the wrong state: a blank profile makes
// every entitled flow land on onboarding right after Dev Login, and a purchase left on the unsubscribed account makes locked
// menus open. Verify the account through the supported API before each flow, restore the profile when it is blank, and fail
// with a clear fixture message when the subscription verdict is wrong or the profile cannot be restored. Dev backends only.
import { execFileSync } from 'node:child_process';

// Values seeded for the entitled fixture (dev data only). Fixtures not listed here are left exactly as they are:
// onboarding flows on the unsubscribed and empty-store accounts need a profile that onboarding itself fills in.
export const baselineProfiles = {
  'entitled-dev': { goal: 'lose_fat', heightCm: 178, weightKg: 80,
    macroTarget: { calories: 595, proteinG: 49, carbsG: 57, fatG: 19, source: 'manual' } },
};

// The server's subscription verdict each shared account must show before a flow starts. Not restored here: a wrong verdict
// means a purchase, grant or expiry from an earlier flow or session, which only its owner can undo.
export const expectedVerdicts = { 'entitled-dev': 'active', 'unsubscribed-dev': 'never_subscribed', 'expired-subscription': 'expired' };

// The dev backend, loopback, or this project's own Vercel preview (which also uses the dev database
// and is what backend-identity.mjs expects for API changes), never production.
export const allowedOrigin = origin => origin === 'https://dev.fitsy.org' || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ||
  /^https:\/\/fitsy-[a-z0-9-]+-dawits-projects-74b6e00f\.vercel\.app$/.test(origin);
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

const tokens = new Map();

export function ensureBaselineProfile(fixture, http = curlJson) {
  const baseline = baselineProfiles[fixture?.name];
  const verdict = expectedVerdicts[fixture?.name];
  if (!baseline && !verdict) return 'not-applicable';
  const { EXPO_PUBLIC_API_URL: origin, EXPO_PUBLIC_DEV_LOGIN_EMAIL: email, EXPO_PUBLIC_DEV_LOGIN_PASSWORD: password } = fixture.env ?? {};
  const fail = reason => { throw new Error(`Fixture ${fixture.name}: ${reason}`); };
  if (!origin || !email || !password) fail('needs EXPO_PUBLIC_API_URL and its own dev login credentials to verify the profile');
  if (!allowedOrigin(origin)) fail('refusing to verify or restore a profile on a backend that is not the dev backend');
  // #995: every dev login spends rate-limiter quota, so reuse one token per account for the whole run and log in again
  // only when the server rejects it with 401. A failed login is reported as is; there is no retry loop against a 5xx.
  const cacheKey = `${origin}\n${email}`;
  const login = () => {
    const result = http('POST', `${origin}/api/auth/login`, { body: { email, password } });
    if (result.status !== 200 || !result.json?.token) fail(`dev login failed (HTTP ${result.status}); cannot verify the profile`);
    tokens.set(cacheKey, result.json.token);
  };
  if (!tokens.has(cacheKey)) login();
  const call = (method, path, extra = {}) => {
    const send = () => http(method, `${origin}${path}`, { token: tokens.get(cacheKey), ...extra });
    const first = send();
    if (first.status !== 401) return first;
    login();
    return send();
  };
  if (verdict) {
    let status = call('GET', '/api/subscriptions/status');
    if (status.status !== 200) fail(`subscription status read failed (HTTP ${status.status})`);
    // The server reports 'unknown' for an account whose RevenueCat state has not been verified
    // recently (idle account, or a long run); ask it to verify once instead of failing the fixture.
    if (status.json?.verdict === 'unknown') {
      call('POST', '/api/subscriptions/sync', { body: { reason: 'manual' } });
      status = call('GET', '/api/subscriptions/status');
      if (status.status !== 200) fail(`subscription status read failed (HTTP ${status.status})`);
    }
    if (status.json?.verdict !== verdict)
      fail(`subscription verdict is ${status.json?.verdict}, expected ${verdict}; an earlier flow or session left the shared account in the wrong state, so flows that depend on it would fail for reasons outside the change. Undo the purchase, grant or expiry and rerun`);
  }
  if (!baseline) return 'present';
  const read = () => call('GET', '/api/user/profile');
  const first = read();
  if (first.status !== 200) fail(`profile read failed (HTTP ${first.status})`);
  if (complete(first.json)) return 'present';
  const restore = call('PATCH', '/api/user/profile', { body: baseline });
  if (restore.status !== 200) fail(`profile is blank and the restore was rejected (HTTP ${restore.status})`);
  const second = read();
  if (second.status !== 200 || !complete(second.json)) fail('profile is still blank after the restore; entitled flows would land on onboarding');
  return 'restored';
}
