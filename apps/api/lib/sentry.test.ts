import * as Sentry from '@sentry/nextjs';
import { apiSentryOptions } from '../sentry.server.config';
import { onRequestError } from '../instrumentation';
import { reportServerError } from './errorAlert';

jest.mock('./errorAlert', () => ({ reportServerError: jest.fn() }));

test('the real Next error hook sends only a sanitized SDK envelope and preserves alerting', async () => {
  const env = { runtime: process.env.NEXT_RUNTIME, dsn: process.env.SENTRY_DSN };
  const envelopes: unknown[] = [];
  process.env.NEXT_RUNTIME = 'nodejs';
  process.env.SENTRY_DSN = 'https://public@example.test/1';
  try {
    Sentry.init({ ...apiSentryOptions, dsn: process.env.SENTRY_DSN,
      transport: () => ({
        send: async (envelope: unknown) => { envelopes.push(envelope); return { statusCode: 200 }; },
        flush: async () => true,
      }),
    });
    Sentry.setUser({ email: 'private@example.test', ip_address: '192.0.2.1' });
    Sentry.setExtra('nutrition', { calories: 999 });
    Sentry.addBreadcrumb({ message: 'private meal' });
    Sentry.getCurrentScope().addAttachment({ filename: 'private.txt', data: 'private attachment' });
    const error = new Error('Bearer fixture-private-token nutrition=999');
    await onRequestError(error, { method: 'GET', path: '/api/user/private-id?secret=fixture-private-token',
      headers: { authorization: 'Bearer fixture-private-token' } },
    { routerKind: 'App Router', routeType: 'route', routePath: '/api/user/[id]', renderSource: 'react-server-components', revalidateReason: undefined });
    expect(await Sentry.flush(2000)).toBe(true);
    expect(envelopes).toHaveLength(1);
    const json = JSON.stringify(envelopes);
    for (const forbidden of ['private@example.test', '192.0.2.1', 'fixture-private-token', 'nutrition', 'private-id', 'private meal', 'private attachment', 'private.txt']) {
      expect(json).not.toContain(forbidden);
    }
    expect(json).toContain('app:///apps/api/lib/sentry.test.ts');
    expect(json).toContain('"in_app":true');
    expect(json).toContain('Application exception (message removed)');
    expect(reportServerError).toHaveBeenCalledWith(expect.stringContaining('GET /api/user/'), error);
  } finally {
    await Sentry.close(2000);
    Sentry.getGlobalScope().clear();
    Sentry.getIsolationScope().clear();
    Sentry.getCurrentScope().clear();
    if (env.runtime === undefined) delete process.env.NEXT_RUNTIME;
    else process.env.NEXT_RUNTIME = env.runtime;
    if (env.dsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = env.dsn;
  }
});
