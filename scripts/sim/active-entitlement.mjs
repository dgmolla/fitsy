// Local evidence setup uses genuine store state and the ordinary server sync.
// No subscription-row writes, registration or release-build bypasses. The
// one deliberate exception (#853, Dawit-authorized): provisionEntitlement
// grants/revokes a RevenueCat promotional entitlement directly on the known
// synthetic entitled-dev/expired-subscription fixture accounts, so billing
// personas don't depend on a real Test Store purchase ever registering.
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
  // #853: a promotional entitlement (provisionEntitlement) isn't tied to any
  // store's sandbox/production distinction, so is_sandbox/store don't apply
  // the same way - accepted here because this function only ever runs
  // against a known synthetic fixture account for one named billing persona.
  // A real platform key must still prove genuine sandbox origin for any
  // other entitlement; never renew an Apple purchase automatically.
  if (subscription?.store !== 'promotional' &&
      (subscription?.is_sandbox !== true || (testStore ? subscription.store !== 'test_store' : subscription.store !== 'app_store')))
    throw new Error('Evidence refuses a production or unknown-store entitlement');
  const expiresAt = Date.parse(pro.expires_date);
  if (!Number.isFinite(expiresAt)) throw new Error('Evidence requires a dated sandbox subscription');
  return { active: expiresAt > now, expiresAt: new Date(expiresAt).toISOString() };
}

export async function verifyInactiveEntitlement({ fixture, built, env = process.env, fetchImpl = fetch, now = Date.now }) {
  if (!['expired-subscription', 'empty-store'].includes(fixture)) throw new Error('Unknown inactive billing fixture');
  const store = evidenceStore(built, env), origin = backendOrigin(env.EXPO_PUBLIC_API_URL);
  const login = await jsonRequest(fetchImpl, `${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.EXPO_PUBLIC_DEV_LOGIN_EMAIL, password: env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD }),
  });
  if (!uuid.test(login.user?.id || '') || typeof login.token !== 'string' || !login.token)
    throw new Error('Evidence login returned no account identity');
  const body = await jsonRequest(fetchImpl, `${rcOrigin}/subscribers/${encodeURIComponent(login.user.id)}`, { headers: {
    authorization: `Bearer ${store.key}`, 'x-platform': 'ios', ...(store.testStore ? { 'x-is-sandbox': 'true' } : {}),
  } });
  const state = sandboxState(body, store.testStore, now());
  if (fixture === 'expired-subscription' && (state.active || !state.expiresAt))
    throw new Error('Expired fixture requires genuine expired sandbox subscription history; login or inactivity alone is insufficient');
  if (fixture === 'empty-store' && (Object.keys(body.subscriber.entitlements).length ||
      Object.keys(body.subscriber.subscriptions).length || Object.keys(body.subscriber.non_subscriptions || {}).length))
    throw new Error('Empty-store fixture requires an account with no purchase history');
  // This read-only check never provisions, renews or syncs a purchase.
  // Native sign-in and the maintained restore assertions must still succeed.
  return { version: 1, fixture, storeMode: built.storeMode, sandbox: true,
    accountHash: createHash('sha256').update(login.user.id).digest('hex'),
    verifiedAt: new Date(now()).toISOString(), expiresAt: state.expiresAt };
}

// A billing walkthrough that starts with an entitlement already close to
// expiry can lapse mid-observation (see finishWalkthrough's post-hoc check);
// catch that in preflight, before the native collector, not after it.
export const MIN_ENTITLED_REMAINING_MS = 10 * 60 * 1000;

export async function verifyRemainingLifetime({ built, env = process.env, fetchImpl = fetch, now = Date.now,
  minRemainingMs = MIN_ENTITLED_REMAINING_MS }) {
  const store = evidenceStore(built, env), origin = backendOrigin(env.EXPO_PUBLIC_API_URL);
  const login = await jsonRequest(fetchImpl, `${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.EXPO_PUBLIC_DEV_LOGIN_EMAIL, password: env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD }),
  });
  if (!uuid.test(login.user?.id || '') || typeof login.token !== 'string' || !login.token)
    throw new Error('Evidence login returned no account identity');
  const body = await jsonRequest(fetchImpl, `${rcOrigin}/subscribers/${encodeURIComponent(login.user.id)}`, { headers: {
    authorization: `Bearer ${store.key}`, 'x-platform': 'ios', ...(store.testStore ? { 'x-is-sandbox': 'true' } : {}),
  } });
  const state = sandboxState(body, store.testStore, now());
  const remainingMs = state.expiresAt ? Date.parse(state.expiresAt) - now() : -Infinity;
  if (!state.active || remainingMs < minRemainingMs)
    throw new Error(state.active
      ? `Entitled-dev fixture has only ${Math.round(remainingMs / 60000)} min of paid lifetime remaining; renew the Test Store purchase before this run`
      : 'Entitled-dev fixture has no active paid lifetime; renew the Test Store purchase before this run');
  return { version: 1, fixture: 'entitled-dev', active: true, expiresAt: state.expiresAt, remainingMs,
    accountHash: createHash('sha256').update(login.user.id).digest('hex'), verifiedAt: new Date(now()).toISOString() };
}

// #853: entitled-dev/expired-subscription are synthetic, known-ahead-of-time
// fixture accounts (never real customers), so a RevenueCat promotional grant
// is a legitimate way to establish their state directly - no real Test
// Store purchase has reliably registered for these accounts (traced and
// confirmed on #853: no identity-sync bug found, RevenueCat's own subscriber
// record never saw either of two independent genuine purchase attempts).
// REVENUECAT_SECRET_KEY is server-only and must never be EXPO_PUBLIC_*.
export async function provisionEntitlement({ fixture, built, env = process.env, fetchImpl = fetch, now = Date.now, expiredDelayMs = 2000 }) {
  if (!['entitled-dev', 'expired-subscription'].includes(fixture)) throw new Error('Unknown provisioned billing fixture');
  const secret = env.REVENUECAT_SECRET_KEY;
  if (!secret) throw new Error('Provisioning requires REVENUECAT_SECRET_KEY (server-only; never ships client-side)');
  evidenceStore(built, env);
  const origin = backendOrigin(env.EXPO_PUBLIC_API_URL);
  const login = await jsonRequest(fetchImpl, `${origin}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.EXPO_PUBLIC_DEV_LOGIN_EMAIL, password: env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD }),
  });
  if (!uuid.test(login.user?.id || '')) throw new Error('Evidence login returned no account identity');
  const entitlementPath = `${rcOrigin}/subscribers/${encodeURIComponent(login.user.id)}/entitlements/pro`;
  const admin = (path, body) => jsonRequest(fetchImpl, `${entitlementPath}${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  // Best-effort cleanup: nothing to revoke is not a failure.
  try { await admin('/revoke_promotionals', {}); } catch { /* no existing grant */ }
  if (fixture === 'entitled-dev') {
    await admin('/promotional', { end_time_ms: now() + 6 * 3600_000 });
  } else {
    const endTimeMs = now() + expiredDelayMs;
    await admin('/promotional', { end_time_ms: endTimeMs });
    await new Promise(resolveWait => setTimeout(resolveWait, Math.max(0, endTimeMs - now()) + 250));
  }
  return { version: 1, fixture, provisionedAt: new Date(now()).toISOString(),
    accountHash: createHash('sha256').update(login.user.id).digest('hex') };
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
