import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { NextRequest } from 'next/server';
import { hasApiTelemetry } from '@/lib/apiTelemetry';

// The JWT provider is external. Every discovered route and Fitsy guard is real.
jest.mock('jose', () => ({
  createRemoteJWKSet: jest.fn(),
  jwtVerify: jest.fn(async () => { throw new Error('Invalid signature'); }),
}));

// Exact paths and methods only. Data endpoints must never be added here.
const publicHandlers: Record<string, string> = {
  'auth/apple/route.ts:POST': 'Exchanges Apple credentials for a Supabase session.',
  'auth/google/route.ts:POST': 'Exchanges Google credentials for a Supabase session.',
  'auth/login/route.ts:POST': 'Exchanges account credentials for a Supabase session.',
  'auth/register/route.ts:POST': 'Creates an account and Supabase session.',
  'health/route.ts:GET': 'Public deployment liveness probe.',
  'revenuecat/webhook/route.ts:POST': 'Provider webhook authenticates its configured secret, not a user JWT.',
  'waitlist/web/route.ts:POST': 'Write-only website opt-in; no nutrition or account data.',
};

function routes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routes(path) : entry.name === 'route.ts' ? [path] : [];
  });
}

const handlers = routes(__dirname).flatMap(path => {
  const route = jest.requireActual<Record<string, unknown>>(path);
  return Object.entries(route).filter(([method]) => /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method))
    .map(([method, handler]) => ({ path: relative(__dirname, path), method,
      handler: handler as (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response> }));
});

test('public exceptions refer to existing handlers and discovery covers the API tree', () => {
  expect(handlers.length).toBeGreaterThan(30);
  const discovered = handlers.map(({ path, method }) => `${path}:${method}`);
  expect(Object.keys(publicHandlers).every(key => discovered.includes(key))).toBe(true);
});

test.each(handlers)('$method $path reports handled failures and latency', ({ handler }) => {
  expect(hasApiTelemetry(handler)).toBe(true);
});

test.each([undefined, 'wrong-secret'])('the webhook rejects an absent/invalid provider credential: %s', async authorization => {
  const original = process.env['REVENUECAT_WEBHOOK_AUTH'];
  process.env['REVENUECAT_WEBHOOK_AUTH'] = 'fixture-webhook-secret';
  try {
    const { POST } = jest.requireActual<{ POST: (request: NextRequest) => Promise<Response> }>('./revenuecat/webhook/route');
    const response = await POST(new NextRequest('http://localhost/api/revenuecat/webhook', {
      method: 'POST', headers: authorization ? { authorization } : {},
    }));
    expect(response.status).toBe(401);
  } finally {
    if (original === undefined) delete process.env['REVENUECAT_WEBHOOK_AUTH'];
    else process.env['REVENUECAT_WEBHOOK_AUTH'] = original;
  }
});

describe.each(handlers.filter(({ path, method }) => !publicHandlers[`${path}:${method}`]))('$method $path', ({ path, method, handler }) => {
  test.each([undefined, 'Basic credentials', 'Bearer invalid.jwt.signature'])('rejects %s before parsing input or touching data', async authorization => {
    const url = 'http://localhost/api/' + path.replace('/route.ts', '').replace('[id]', 'fixture');
    const response = await handler(new NextRequest(url, { method,
      headers: authorization ? { authorization } : {},
    }), { params: Promise.resolve({ id: 'fixture' }) });
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toEqual(expect.any(String));
    expect(body).not.toHaveProperty('data');
  });
});
