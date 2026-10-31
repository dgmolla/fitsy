// Local evidence setup uses genuine store state and the ordinary server sync.
// No grants, subscription-row writes, registration or release-build bypasses.
import { backendOrigin } from './backend-identity.mjs';
import { createHash } from 'node:crypto';

const rcOrigin = 'https://api.revenuecat.com/v1';
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function evidenceStore(built, env) {
  backendOrigin(env.EXPO_PUBLIC_API_URL);
  if (env.EXPO_PUBLIC_SUPABASE_URL?.includes('zaxkmjqozvmbifiwbxps'))
    throw new Error('Production Supabase is forbidden for evidence');
  if (!env.EXPO_PUBLIC_DEV_LOGIN_EMAIL || !env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD)
    throw new Error('Active evidence requires the disposable fixture login credentials');
  if (built.storeMode === 'test-store' && built.configuration === 'Debug' &&
      built.buildMode === 'owned-metro-test-store' && env.EXPO_PUBLIC_REVENUECAT_TEST_KEY?.startsWith('test_'))
    return { key: env.EXPO_PUBLIC_REVENUECAT_TEST_KEY, testStore: true };
  if (built.storeMode === 'apple-simulator' && built.configuration === 'Release' && built.buildMode === 'embedded-release' &&
      env.EXPO_PUBLIC_REVENUECAT_IOS_KEY?.startsWith('appl_'))
    return { key: env.EXPO_PUBLIC_REVENUECAT_IOS_KEY, testStore: false };
  throw new Error('Active evidence requires a Debug Test Store build or a verified Apple sandbox purchase');
}

async function jsonRequest(fetchImpl, url, options = {}) {
  let response;
  try { response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error(`Evidence entitlement request failed: ${new URL(url).pathname.split('/')[1]}`); }
  if (!response.ok) throw new Error(`Evidence entitlement request failed (HTTP ${response.status})`);
  try { return await response.json(); }
  catch { throw new Error('Evidence entitlement response is not JSON'); }
}

export function sandboxState(body, testStore, now = Date.now()) {
  const subscriber = body?.subscriber;
  if (!subscriber || !subscriber.entitlements || !subscriber.subscriptions ||
      typeof subscriber.entitlements !== 'object' || Array.isArray(subscriber.entitlements) ||
      typeof subscriber.subscriptions !== 'object' || Array.isArray(subscriber.subscriptions))
    throw new Error('RevenueCat subscriber state is unknown');
  const pro = subscriber.entitlements?.pro;
  if (!pro) return { active: false, expiresAt: null };
  const subscription = subscriber.subscriptions?.[pro.product_identifier];
  // Even a real platform key must prove sandbox origin before evidence setup
  // can use the account. Never renew an Apple purchase automatically.
  if (subscription?.is_sandbox !== true || (testStore ? subscription.store !== 'test_store' : subscription.store !== 'app_store'))
    throw new Error('Evidence refuses a production, promotional or unknown-store entitlement');
  const expiresAt = Date.parse(pro.expires_date);
  if (!Number.isFinite(expiresAt)) throw new Error('Evidence requires a dated sandbox subscription');
  return { active: expiresAt > now, expiresAt: new Date(expiresAt).toISOString() };
}

export async function prepareActiveEntitlement({ built, env = process.env, renew, fetchImpl = fetch, now = Date.now }) {
  const store = evidenceStore(built, env), origin = backendOrigin(env.EXPO_PUBLIC_API_URL);
  const login = await jsonRequest(fetchImpl, `${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.EXPO_PUBLIC_DEV_LOGIN_EMAIL, password: env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD }),
  });
  if (!uuid.test(login.user?.id || '') || typeof login.token !== 'string' || !login.token)
    throw new Error('Evidence login returned no account identity');
  const readStore = async () => sandboxState(await jsonRequest(fetchImpl,
    `${rcOrigin}/subscribers/${encodeURIComponent(login.user.id)}`, { headers: {
      authorization: `Bearer ${store.key}`, 'x-platform': 'ios',
      ...(store.testStore ? { 'x-is-sandbox': 'true' } : {}),
    } }), store.testStore, now());
  let state = await readStore(), renewed = false;
  if (!state.active) {
    if (!store.testStore || !renew) throw new Error('Sandbox entitlement is inactive; provision a real test purchase before evidence');
    // The caller validates the installed build and serves these same credentials
    // through owned Metro before entering the saved Test Store purchase flow.
    await renew();
    renewed = true;
    state = await readStore();
  }
  if (!state.active) throw new Error('Test Store purchase did not establish an active RevenueCat entitlement');
  const options = { headers: { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' } };
  const synced = await jsonRequest(fetchImpl, `${origin}/api/subscriptions/sync`, {
    ...options, method: 'POST', body: JSON.stringify({ reason: 'purchase' }),
  });
  const status = await jsonRequest(fetchImpl, `${origin}/api/subscriptions/status`, options);
  const verifiedAt = Date.parse(status.lastRcVerifiedAt), expiry = Date.parse(status.expiresAt);
  if (synced.synced !== true || status.active !== true || status.verdict !== 'active' || status.status !== 'active' ||
      status.stale !== false || !Number.isFinite(verifiedAt) || Math.abs(now() - verifiedAt) > 60_000 ||
      !Number.isFinite(expiry) || expiry <= now())
    throw new Error('Server did not verify active paid access; stale rows and dev/reviewer bypasses cannot supply evidence');
  // A diagnostic receipt contains no credentials, tokens or provider payloads.
  return { version: 1, storeMode: built.storeMode, sandbox: true, renewed,
    accountHash: createHash('sha256').update(login.user.id).digest('hex'),
    verifiedAt: new Date(now()).toISOString(), expiresAt: state.expiresAt, lastRcVerifiedAt: status.lastRcVerifiedAt };
}
