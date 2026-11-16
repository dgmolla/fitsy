import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';

type State = { verdict: string; profile: { user: Record<string, unknown>; macroTarget: unknown }; loginStatus: number; patchStatus: number; patches: number };
const blank = () => ({ user: { goal: null, heightCm: null, weightKg: null }, macroTarget: null });
const filled = () => ({ user: { goal: 'lose_fat', heightCm: 178, weightKg: 80 }, macroTarget: { calories: 595 } });

function startServer(state: State): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const send = (status: number, json: unknown) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(json)); };
      if (request.url === '/api/auth/login') return state.loginStatus === 200 ? send(200, { token: 't-1' }) : send(state.loginStatus, { error: 'no' });
      if (request.headers.authorization !== 'Bearer t-1') return send(401, { error: 'unauthorized' });
      if (request.url === '/api/subscriptions/status') return send(200, { verdict: state.verdict, active: state.verdict === 'active' });
      if (request.method === 'PATCH') {
        state.patches += 1;
        if (state.patchStatus !== 200) return send(state.patchStatus, { error: 'rejected' });
        const update = JSON.parse(body);
        state.profile = { user: { goal: update.goal, heightCm: update.heightCm, weightKg: update.weightKg }, macroTarget: update.macroTarget };
        return send(200, state.profile);
      }
      return send(200, state.profile);
    });
  });
  return new Promise(resolvePromise => server.listen(0, () =>
    resolvePromise({ server, origin: `http://localhost:${(server.address() as { port: number }).port}` })));
}

// The module runs in a child process (real curl, real HTTP); this process keeps serving.
function ensure(fixture: object): Promise<string> {
  const script = `import { ensureBaselineProfile } from ${JSON.stringify(resolve(__dirname, 'fixture-profile.mjs'))};`
    + `try { process.stdout.write('OK:' + ensureBaselineProfile(${JSON.stringify(fixture)})); } catch (error) { process.stdout.write('ERR:' + error.message); }`;
  return new Promise(resolvePromise => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script]);
    let out = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.on('close', () => resolvePromise(out));
  });
}

const credentials = (origin: string) => ({ EXPO_PUBLIC_API_URL: origin, EXPO_PUBLIC_DEV_LOGIN_EMAIL: 'fixture@example.test', EXPO_PUBLIC_DEV_LOGIN_PASSWORD: 'not-a-real-password' });

describe('entitled fixture baseline profile (#934)', () => {
  let state: State; let server: Server; let origin: string;
  beforeEach(async () => {
    state = { verdict: 'active', profile: blank(), loginStatus: 200, patchStatus: 200, patches: 0 };
    ({ server, origin } = await startServer(state));
  });
  afterEach(() => new Promise<void>(done => { server.close(() => done()); }));

  test('a complete profile is left alone', async () => {
    state.profile = filled();
    expect(await ensure({ name: 'entitled-dev', env: credentials(origin) })).toBe('OK:present');
    expect(state.patches).toBe(0);
  });

  test('a blank profile is restored through the API and verified', async () => {
    expect(await ensure({ name: 'entitled-dev', env: credentials(origin) })).toBe('OK:restored');
    expect(state.patches).toBe(1);
    expect(state.profile.user).toMatchObject({ goal: 'lose_fat', heightCm: 178, weightKg: 80 });
    expect(state.profile.macroTarget).toMatchObject({ calories: 595, proteinG: 49, carbsG: 57, fatG: 19 });
  });

  test('a rejected restore fails with a clear message', async () => {
    state.patchStatus = 400;
    expect(await ensure({ name: 'entitled-dev', env: credentials(origin) })).toContain('ERR:Fixture entitled-dev: profile is blank and the restore was rejected (HTTP 400)');
  });

  test('a failed dev login fails before touching the profile', async () => {
    state.loginStatus = 401;
    expect(await ensure({ name: 'entitled-dev', env: credentials(origin) })).toContain('dev login failed (HTTP 401)');
    expect(state.patches).toBe(0);
  });

  test('never writes to a backend that is not the dev backend', async () => {
    const result = await ensure({ name: 'entitled-dev', env: credentials('https://api.example.com') });
    expect(result).toContain('not the dev backend');
    expect(state.patches).toBe(0);
  });

  test('fixtures without any expectation are not touched', async () => {
    expect(await ensure({ name: 'empty-store', env: credentials(origin) })).toBe('OK:not-applicable');
    expect(state.patches).toBe(0);
  });

  test('the entitled account must show an active verdict', async () => {
    state.verdict = 'expired';
    expect(await ensure({ name: 'entitled-dev', env: credentials(origin) })).toContain('subscription verdict is expired, expected active');
    expect(state.patches).toBe(0);
  });

  test.each([['never_subscribed', 'OK:present'], ['active', 'subscription verdict is active, expected never_subscribed']])(
    'the unsubscribed account with verdict %s gives %s (never touches its profile)', async (verdict, expected) => {
      state.verdict = verdict;
      expect(await ensure({ name: 'unsubscribed-dev', env: credentials(origin) })).toContain(expected);
      expect(state.patches).toBe(0);
    });

  test.each([['expired', 'OK:present'], ['never_subscribed', 'expected expired']])('the expired account with verdict %s gives %s', async (verdict, expected) => {
    state.verdict = verdict;
    expect(await ensure({ name: 'expired-subscription', env: credentials(origin) })).toContain(expected);
  });
});
