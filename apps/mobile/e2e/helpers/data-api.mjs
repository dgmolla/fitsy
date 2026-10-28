// Maestro executes this file as a script. Keep tokens and credentials local.
(function () {
  var base = typeof EXPO_PUBLIC_API_URL === 'string' ? EXPO_PUBLIC_API_URL : '';
  // The host verifies fitsy-api project/source identity; immutable deployments use fitsy-<hash> URLs.
  if (!/^https:\/\/(?:dev\.fitsy\.org|fitsy-[a-z0-9-]+-dawits-projects-74b6e00f\.vercel\.app)$/.test(base)) {
    throw new Error('Maestro refuses production and unrelated API origins; pass the app EXPO_PUBLIC_API_URL');
  }
  output.dataApiResponses = [];
  output.dataApiLoginStatus = 0;
  function reportPreflight() {
    // Maestro's failed command/JUnit artifacts retain labels without resolving
    // their output variables. Log only statuses, never bodies or credentials.
    console.log('[data-api] ' + JSON.stringify({
      unauthStatus: output.dataApiUnauthStatus,
      invalidStatus: output.dataApiInvalidStatus,
      loginStatus: output.dataApiLoginStatus,
    }));
  }
  var paths = output.apiPaths.map(function (path) {
    if (!/^\/api\/restaurants(?:[/?]|$)/.test(path)) throw new Error('Expected a relative restaurant API path');
    return path;
  });
  output.dataApiUnauthStatus = http.get(base + paths[0]).status;
  output.dataApiInvalidStatus = http.get(base + paths[0], { headers: { Authorization: 'Bearer invalid.jwt.signature' } }).status;
  // Let the caller's required, labelled assertion report these HTTP statuses.
  // Throwing here makes Maestro serialize a Graal exception graph, truncating
  // its command JSON before the useful error. Never log in to a stale backend.
  if (output.dataApiUnauthStatus !== 401 || output.dataApiInvalidStatus !== 401) {
    reportPreflight();
    return;
  }
  var login = http.post(base + '/api/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });
  output.dataApiLoginStatus = login.status;
  reportPreflight();
  if (login.status !== 200) return;
  var token = json(login.body).token;
  if (!token) return;
  output.dataApiResponses = paths.map(function (path) {
    var response = http.get(base + path, { headers: { Authorization: 'Bearer ' + token } });
    return { status: response.status, body: response.body };
  });
})();
