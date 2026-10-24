// Hosted Test Store coverage and real-store acceptance have different fixtures.
// Keep Apple history transfer explicit: it remains a required local journey.
export function hostedCoverage(flows) {
  return {
    hosted: flows.filter(flow => flow !== 'subscription-restore-expired'),
    acceptance: flows.filter(flow => flow === 'subscription-restore-expired').map(flow => ({
      flow, required: true, status: 'not_run', storeMode: 'apple',
      reason: 'Test Store cannot transfer purchase history between recreated accounts; real Apple acceptance remains required',
      command: `node scripts/sim/product-flow.mjs run <UDID> ${flow} --mode=final-candidate`,
    })),
  };
}

export const billingFixture = flow => flow === 'subscription-expired-routing' ? 'expired'
  : flow === 'subscription-restore-empty' ? 'never_subscribed' : null;

export function hostedAccounts(flows, env) {
  const account = (kind, email, password) => {
    email = email?.trim().toLowerCase();
    if (!email || email === 'dev@fitsy.local' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password)
      throw new Error(`A disposable ${kind} Test Store account and password are required`);
    return { kind, email, password };
  };
  const accounts = {
    never_subscribed: account('never_subscribed', env.EXPO_PUBLIC_DEV_LOGIN_EMAIL, env.EXPO_PUBLIC_DEV_LOGIN_PASSWORD),
  };
  if (flows.some(flow => billingFixture(flow) === 'expired')) {
    accounts.expired = account('expired', env.FITSY_SIM_EXPIRED_LOGIN_EMAIL, env.FITSY_SIM_EXPIRED_LOGIN_PASSWORD);
    if (accounts.expired.email === accounts.never_subscribed.email)
      throw new Error('Expired and never-subscribed fixtures must use distinct disposable accounts');
  }
  return accounts;
}

export async function verifyBillingFixture(account) {
  // Only the ordinary dev API may establish fixture state. Never manufacture a
  // subscription row or expose the login/token in CI logs or artifacts.
  const request = async (path, body, token) => {
    const response = await fetch(`https://dev.fitsy.org${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(35000),
    });
    if (!response.ok) throw new Error(`${account.kind} fixture ${path} failed (HTTP ${response.status})`);
    return response.json();
  };
  const auth = await request('/api/auth/login', { email: account.email, password: account.password });
  if (!auth.token || !auth.user?.id || auth.user.email?.toLowerCase() !== account.email)
    throw new Error(`${account.kind} fixture did not authenticate its configured account`);
  const status = await request('/api/subscriptions/sync', {}, auth.token);
  const age = Date.now() - Date.parse(status.lastRcVerifiedAt);
  if (status.synced !== true || status.verdict !== account.kind || status.active !== false || status.stale !== false ||
      !Number.isFinite(age) || age < -30000 || age > 300000)
    throw new Error(`${account.kind} fixture requires a fresh synced inactive ${account.kind} verdict; prepare its real Test Store history`);
  return { kind: account.kind, userId: auth.user.id, verdict: status.verdict, lastRcVerifiedAt: status.lastRcVerifiedAt };
}

export function hostedJourney(flow, documents, setup) {
  const fixture = billingFixture(flow);
  if (!fixture) return documents;
  if (!setup?.[1]?.length || setup[0]?.appId !== documents[0]?.appId)
    throw new Error('Hosted billing sign-in setup is missing or incompatible');
  const id = fixture === 'expired' ? 'resubscribe-restore' : 'paywall-restore';
  return [documents[0], [...setup[1], { extendedWaitUntil: { visible: { id }, timeout: 30000 } }, ...documents[1]]];
}
