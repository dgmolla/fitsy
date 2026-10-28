import { randomUUID } from 'node:crypto';
import { consumeSharedQuota } from '../../apps/api/services/rateLimitStore.js';

// Exercise the runtime EVAL, including writes, without consuming user quotas.
// Concurrent builds use distinct identities; all probe keys expire in one second.
consumeSharedQuota({ namespace: 'deployment-readiness', windowMs: 1_000, max: 1, maxKeys: 1_000 }, randomUUID())
  .then(result => {
    if (!result.ok) throw new Error('readiness quota unavailable');
    process.stdout.write('Shared rate-limit store preflight passed\n');
  })
  .catch(() => {
    // Provider errors can contain credentials. Emit only the recovery contract.
    console.error('Shared rate-limit store preflight failed: configure UPSTASH_REDIS_REST_URL and '
      + 'UPSTASH_REDIS_REST_TOKEN for this Vercel environment with a writable Redis REST token; '
      + 'verify connectivity and EVAL access, then retry the guarded Git build. Migration/build withheld.');
    process.exitCode = 1;
  });
