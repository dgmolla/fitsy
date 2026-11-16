/** Only code locations and release identity may cross the crash-reporting boundary. */
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value !== null && typeof value === 'object' ? value as RecordValue : {};
const text = (value: unknown, pattern: RegExp): string | undefined =>
  typeof value === 'string' && pattern.test(value) ? value : undefined;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const position = (value: unknown): number | undefined =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined;

/** Remove host, query, fragment and private machine/container prefixes. */
function codePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.split(/[?#]/)[0]?.replace(/\\/g, '/') ?? '';
  const bundle = path.split('/').pop();
  if (bundle && /^(?:main\.jsbundle|index\.(?:ios\.|android\.)?bundle|[a-f0-9-]{36}\.hbc)$/.test(bundle)) {
    return `app:///${bundle}`;
  }
  const source = path.match(/(?:^|\/)((?:apps\/(?:mobile|api)|packages\/shared|node_modules|\.next|_next|_expo\/static\/js)\/.+)$/)?.[1];
  if (!source || source.includes('..') || !/^[\w./()[\]@+-]+\.(?:[cm]?js|jsx|ts|tsx|hbc)$/.test(source)) return undefined;
  // Package scopes are valid source paths; email-like segments are not.
  if (source.split('/').some(segment => segment.includes('@') && !/^@[\w-]+$/.test(segment))) return undefined;
  return `app:///${source}`;
}

function stackFrames(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(-50).map(record).flatMap(frame => {
    const filename = codePath(frame.filename ?? frame.abs_path);
    return filename ? [{ filename,
      function: text(frame.function, /^(?:[\w$]+[.$])*[\w$]+$/) ?? '<anonymous>',
      lineno: position(frame.lineno) ?? 0,
      colno: position(frame.colno) ?? 0,
      in_app: typeof frame.in_app === 'boolean' ? frame.in_app : !filename.includes('/node_modules/'),
    }] : [];
  });
}

/** Rebuild, never spread, SDK events: new SDK fields are excluded by default. */
export function sanitizeCrashEvent(input: unknown, hint?: { attachments?: unknown[] }) {
  if (hint) hint.attachments = [];
  const event = record(input);
  const exceptions = record(event.exception).values;
  if (event.type || !Array.isArray(exceptions) || !exceptions.length) return null;
  const values = exceptions.slice(0, 5).map(record).map(exception => ({
    type: text(exception.type, /^(?:Error|TypeError|RangeError|ReferenceError|SyntaxError|URIError|EvalError|AggregateError)$/) ?? 'Error',
    value: 'Application exception (message removed)',
    stacktrace: { frames: stackFrames(record(exception.stacktrace).frames) },
    mechanism: { type: 'generic', handled: record(exception.mechanism).handled !== false },
  }));
  // Unknown/non-code stacks are not useful enough to justify sending an event.
  if (!values.some(value => value.stacktrace.frames.length)) return null;
  const images = record(event.debug_meta).images;
  const eventId = text(event.event_id, /^[a-f0-9]{32}$/i);
  const release = text(event.release, /^(?:com\.fitsy\.mobile|fitsy-api)@[a-zA-Z0-9.+-]{1,100}$/);
  const dist = text(event.dist, /^(?:[a-f0-9-]{36}|[0-9]{1,10}|server|embedded)$/);
  const environment = text(event.environment, /^(?:production|testflight|preview|development|test)$/);
  return {
    type: undefined,
    ...(eventId ? { event_id: eventId } : {}),
    ...(typeof event.timestamp === 'number' && Number.isFinite(event.timestamp) ? { timestamp: event.timestamp } : {}),
    platform: 'javascript',
    level: event.level === 'fatal' ? 'fatal' as const : 'error' as const,
    ...(release ? { release } : {}),
    ...(dist ? { dist } : {}),
    ...(environment ? { environment } : {}),
    // RN ingest otherwise infers the device's IP even with sendDefaultPii=false.
    user: { ip_address: '0.0.0.0' },
    exception: { values },
    debug_meta: { images: Array.isArray(images) ? images.map(record).flatMap(image => {
      const codeFile = codePath(image.code_file);
      const debugId = text(image.debug_id, uuid);
      return codeFile && debugId ? [{ type: 'sourcemap' as const, code_file: codeFile, debug_id: debugId }] : [];
    }) : [] },
  };
}
