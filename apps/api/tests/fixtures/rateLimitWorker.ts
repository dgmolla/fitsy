import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { POST as apple } from '../../app/api/auth/apple/route';
import { POST as google } from '../../app/api/auth/google/route';
import { POST as login } from '../../app/api/auth/login/route';
import { POST as register } from '../../app/api/auth/register/route';
import { POST as waitlist } from '../../app/api/waitlist/web/route';
import { requireAuth } from '../../lib/auth';
import { createRateLimiter, type RateLimiterOptions } from '../../lib/rateLimit';

export interface WorkerRequest {
  route: 'apple' | 'google' | 'login' | 'register' | 'waitlist' | 'data' | 'quota';
  headers?: Record<string, string>;
  user?: string;
  quota?: RateLimiterOptions;
}

async function start() {
  const keys = await generateKeyPair('ES256');
  const jwk = { ...await exportJWK(keys.publicKey), kid: 'quota-fixture', alg: 'ES256', use: 'sig' };
  const pending = new Map<string, (value: number[] | Error) => void>();
  // Only external Redis/JWKS transports are replaced. The parent owns shared
  // state or an isolated real Redis container; no HTTP listener is required.
  global.fetch = async (input, init) => {
    if (String(input).startsWith('https://fixture.supabase.test/')) return Response.json({ keys: [jwk] });
    const id = randomUUID();
    const result = await new Promise<number[] | Error>(resolve => {
      pending.set(id, resolve);
      process.send!({ kind: 'store', id, command: JSON.parse(String(init?.body)) });
    });
    if (result instanceof Error) throw result;
    return Response.json({ result });
  };
  process.on('message', async (message: { kind: string; id: string; result?: number[]; error?: string; request?: WorkerRequest }) => {
    if (message.kind === 'store-reply') {
      pending.get(message.id)?.(message.error ? new Error(message.error) : message.result!);
      pending.delete(message.id);
      return;
    }
    const { route, headers = {}, user, quota } = message.request!;
    try {
      if (route === 'quota') {
        const result = await createRateLimiter(quota!).check(user!);
        process.send!({ kind: 'reply', id: message.id, result });
        return;
      }
      if (user) {
        headers['authorization'] = `Bearer ${await new SignJWT({ email: `${user}@example.test`, role: 'authenticated' })
          .setSubject(user).setIssuedAt().setExpirationTime('5m').setIssuer('https://fixture.supabase.test/auth/v1')
          .setAudience('authenticated').setProtectedHeader({ alg: 'ES256', kid: 'quota-fixture' }).sign(keys.privateKey)}`;
      }
      const request = new NextRequest(`https://api.example.test/${route}`, {
        method: route === 'data' ? 'GET' : 'POST', headers,
        ...(route === 'data' ? {} : { body: JSON.stringify(route === 'waitlist' ? { hp: 'fixture' } : {}) }),
      });
      const result = route === 'data' ? await requireAuth(request)
        : await ({ apple, google, login, register, waitlist }[route])(request);
      process.send!({ kind: 'reply', id: message.id, result: result instanceof NextResponse
        ? { status: result.status, headers: Object.fromEntries(result.headers), body: await result.json() }
        : { status: 200, body: result } });
    } catch (error) {
      process.send!({ kind: 'reply', id: message.id, error: String(error) });
    }
  });
  process.send!({ kind: 'ready' });
}
start().catch(error => { console.error(error); process.exitCode = 1; });
