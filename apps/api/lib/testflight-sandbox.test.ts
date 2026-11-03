import { fetchProEntitlement } from '../services/revenuecatService';

test('TestFlight and App Review sandbox entitlements remain usable with the production platform key', async () => {
  const env = process.env, fetch = global.fetch;
  process.env = { ...env, NODE_ENV: 'production', VERCEL_ENV: 'production', REVENUECAT_PUBLIC_API_KEY: 'appl_fixture' };
  const info = jest.spyOn(console, 'info').mockImplementation(() => {});
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ subscriber: {
    entitlements: { pro: { product_identifier: 'yearly', expires_date: '2099-01-01T00:00:00Z' } },
    subscriptions: { yearly: { is_sandbox: true, store: 'app_store' } },
  } }) });
  try {
    expect(await fetchProEntitlement('testflight-fixture')).toMatchObject({ active: true, plan: 'yearly' });
    expect(global.fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: { authorization: 'Bearer appl_fixture', 'x-platform': 'ios' },
    }));
  } finally { process.env = env; global.fetch = fetch; info.mockRestore(); }
});
