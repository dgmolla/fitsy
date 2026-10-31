// Canonical lifecycle for the Mac poller and its one-time native bootstrap.
// Keep the existing seed identity and state format so real purchase history survives adoption.
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { backendOrigin } from './backend-identity.mjs';

export const EXPIRED_WAIT_MS = 35 * 60 * 1000;
export const EXPIRED_STATE_FILE = join(homedir(), '.fitsy-sim/expired-state.json');
export const EXPIRED_ADVISORY = 'expired fixture lapsing, ready after ~30 min';

export function requireExpiredEnvironment(env) {
  // The host selects and verifies fitsy-api's nonproduction deployment before
  // Metro or fixtures run. Keep that same origin for login and subscription sync.
  const origin = env.EXPO_PUBLIC_API_URL;
  try {
    const url = new URL(origin);
    const local = url.origin === origin && url.protocol === 'http:' &&
      ['localhost', '127.0.0.1'].includes(url.hostname);
    if (!local) backendOrigin(origin);
  } catch {
    throw new Error('Expired fixture requires dev or a verified fitsy-api preview; production and unrelated origins are refused');
  }
  if (!env.EXPO_PUBLIC_REVENUECAT_TEST_KEY?.startsWith('test_')) {
    throw new Error('Expired fixture requires RevenueCat Test Store');
  }
  if (env.FITSY_SIM_EXPIRED_LOGIN_EMAIL !== 'seed-sim-expired@fitsy.dev' || !env.FITSY_SIM_EXPIRED_LOGIN_PASSWORD) {
    throw new Error('Expired fixture requires the persistent seed account credentials');
  }
}

export async function expiredSession(env) {
  requireExpiredEnvironment(env);
  const response = await fetch(new URL('/api/auth/login', env.EXPO_PUBLIC_API_URL), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.FITSY_SIM_EXPIRED_LOGIN_EMAIL, password: env.FITSY_SIM_EXPIRED_LOGIN_PASSWORD }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Expired fixture login failed (HTTP ${response.status})`);
  const result = await response.json();
  if (!result.token || !/^[0-9a-f-]{36}$/i.test(result.user?.id || '')) throw new Error('Expired fixture login returned no identity');
  return { userId: result.user.id, token: result.token };
}

export async function prepareExpiredFixture({ env, runMakeExpired, stateFile = EXPIRED_STATE_FILE, now = Date.now }) {
  const { userId } = await expiredSession(env);
  // Invalid state fails closed; a different auth UUID starts a new lifecycle.
  const saved = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
  let state = saved;
  if (!state || state.userId !== userId) {
    await runMakeExpired({ allowPurchase: true });
    state = { userId, purchasedAt: new Date(now()).toISOString() };
    const temporary = stateFile + '.tmp';
    writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    renameSync(temporary, stateFile);
    return { ready: false, advisory: EXPIRED_ADVISORY, ...state };
  }
  const purchasedAt = Date.parse(state.purchasedAt);
  if (!Number.isFinite(purchasedAt) || purchasedAt > now()) throw new Error('Expired fixture has an invalid purchase timestamp');
  if (now() - purchasedAt < EXPIRED_WAIT_MS) return { ready: false, advisory: EXPIRED_ADVISORY, ...state };
  // Sign in for every gate with purchases disabled so history cannot silently renew.
  await runMakeExpired({ allowPurchase: false });
  return { ready: true, ...state };
}
