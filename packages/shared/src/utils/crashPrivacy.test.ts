import { sanitizeCrashEvent } from './crashPrivacy';

const secret = 'alice@example.test Bearer fixture-secret calories=900 lat=34.123';
const frame = { filename: '/var/task/apps/api/.next/server/app/api/user/route.js',
  function: 'loadProfile', lineno: 25, colno: 7, in_app: true };

test('allowlists crash code locations and identity, excluding sensitive data at every level', () => {
  const hint = { attachments: [{ filename: 'private.txt', data: secret }] };
  const clean = sanitizeCrashEvent({
    event_id: 'a'.repeat(32), release: `fitsy-api@${'b'.repeat(40)}`, dist: 'server', environment: 'production',
    user: { email: secret }, request: { data: secret, headers: { authorization: secret }, url: secret },
    message: secret, logentry: { message: secret }, extra: { nutrition: secret }, contexts: { device: secret },
    breadcrumbs: [{ message: secret }], tags: { meal: secret }, transaction: secret, server_name: secret,
    exception: { values: [{ type: 'TypeError', value: secret,
      mechanism: { type: secret, handled: false, data: { value: secret } },
      stacktrace: { frames: [{ ...frame, vars: { meal: secret }, context_line: secret, pre_context: [secret], post_context: [secret] }] },
    }] },
    debug_meta: { images: [{ type: 'sourcemap', code_file: frame.filename, debug_id: '12345678-1234-1234-1234-123456789abc', private: secret }] },
    future_sdk_field: secret,
  }, hint);
  expect(hint.attachments).toEqual([]);
  expect(clean).toMatchObject({
    event_id: 'a'.repeat(32), release: `fitsy-api@${'b'.repeat(40)}`, dist: 'server', environment: 'production',
    user: { ip_address: '0.0.0.0' },
    exception: { values: [{ type: 'TypeError', value: 'Application exception (message removed)',
      mechanism: { type: 'generic', handled: false },
      stacktrace: { frames: [{ ...frame, filename: 'app:///apps/api/.next/server/app/api/user/route.js' }] },
    }] },
    debug_meta: { images: [{ type: 'sourcemap', code_file: 'app:///apps/api/.next/server/app/api/user/route.js',
      debug_id: '12345678-1234-1234-1234-123456789abc' }] },
  });
  const json = JSON.stringify(clean);
  for (const forbidden of [secret, 'authorization', 'nutrition', 'breadcrumbs', 'context_line', 'private', 'future_sdk_field', 'server_name']) {
    expect(json).not.toContain(forbidden);
  }
});

test.each([
  ['/private/var/mobile/Containers/Data/Application/private-device/main.jsbundle', 'app:///main.jsbundle'],
  ['http://localhost:8081/index.bundle?email=alice@example.test', 'app:///index.bundle'],
  ['https://updates.example.test/_expo/static/js/ios/index-123.js#token', 'app:///_expo/static/js/ios/index-123.js'],
  ['/Users/private-name/fitsy/apps/mobile/app/_layout.tsx', 'app:///apps/mobile/app/_layout.tsx'],
])('retains sourcemappable code without host, private prefixes or query: %s', (filename, expected) => {
  const event = sanitizeCrashEvent({ exception: { values: [{ stacktrace: { frames: [{ ...frame, filename }] } }] } });
  expect(event?.exception.values[0]?.stacktrace.frames[0]?.filename).toBe(expected);
});

test('drops unknown events/paths and replaces custom error messages, types and identity', () => {
  expect(sanitizeCrashEvent({ message: secret })).toBeNull();
  expect(sanitizeCrashEvent({ type: 'transaction', exception: { values: [{}] } })).toBeNull();
  expect(sanitizeCrashEvent({ exception: { values: [{ stacktrace: { frames: [{ filename: '/Users/alice/private.txt' }] } }] } })).toBeNull();
  const event = sanitizeCrashEvent({ release: secret, dist: secret, environment: secret,
    exception: { values: [{ type: secret, value: secret, stacktrace: { frames: [{ ...frame, function: secret }] } }] } });
  expect(event?.exception.values[0]?.type).toBe('Error');
  expect(JSON.stringify(event)).not.toContain(secret);
});
