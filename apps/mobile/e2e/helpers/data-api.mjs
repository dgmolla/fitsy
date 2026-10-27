// Maestro executes this file as a script. Keep tokens and credentials local.
(function () {
  var base = 'https://dev.fitsy.org';
  output.dataApiResponses = [];
  output.dataApiLoginStatus = 0;
  var paths = output.apiPaths.map(function (path) {
    if (path.indexOf(base + '/api/') === 0) path = path.slice(base.length);
    if (path.indexOf('/api/restaurants') !== 0) throw new Error('Expected a dev restaurant API path');
    return path;
  });
  output.dataApiUnauthStatus = http.get(base + paths[0]).status;
  output.dataApiInvalidStatus = http.get(base + paths[0], { headers: { Authorization: 'Bearer invalid.jwt.signature' } }).status;
  var login = http.post(base + '/api/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });
  output.dataApiLoginStatus = login.status;
  if (login.status !== 200) return;
  var token = json(login.body).token;
  if (!token) return;
  output.dataApiResponses = paths.map(function (path) {
    var response = http.get(base + path, { headers: { Authorization: 'Bearer ' + token } });
    return { status: response.status, body: response.body };
  });
})();
