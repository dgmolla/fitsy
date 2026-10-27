/**
 * Supabase logs rejected fetch errors before returning them to its callers.
 * Normalize failure details before SDK background tasks can log them.
 * Keep HTTP statuses and the SDK's session/weak-password error classifications.
 */
export const authFetch: typeof fetch = async (...args) => {
  try {
    const response = await fetch(...args);
    if (response.ok) return response;
    let errorCode: string | undefined;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object') {
        const fields = body as { code?: unknown; error_code?: unknown };
        const code = fields.code ?? fields.error_code;
        if (code === 'session_not_found' || code === 'weak_password') errorCode = code;
      }
    } catch { /* Provider bodies are optional and never become diagnostics. */ }
    return new Response(JSON.stringify({ message: 'Authentication provider rejected request',
      ...(errorCode ? { error_code: errorCode } : {}) }), {
      status: response.status, headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    // eslint-disable-next-line no-console
    console.warn('[auth] provider_unavailable');
    // Use the constructor: React Native's fetch polyfill lacks Response.json().
    return new Response('{"message":"Authentication provider unavailable"}', {
      status: 503, headers: { 'Content-Type': 'application/json' },
    });
  }
};
