// Maestro executes this file as a script. Seed board posts from throwaway
// authors, or check which of them the fixture account can still see.
// Keep credentials local: only ids and public strings are written to output.
(function () {
  var base = typeof EXPO_PUBLIC_API_URL === 'string' ? EXPO_PUBLIC_API_URL : '';
  if (!/^https:\/\/(?:dev\.fitsy\.org|fitsy-[a-z0-9-]+-dawits-projects-74b6e00f\.vercel\.app)$/.test(base)) {
    throw new Error('Maestro refuses production and unrelated API origins; pass the app EXPO_PUBLIC_API_URL');
  }
  var jsonHeaders = { 'Content-Type': 'application/json' };
  function login(email, password) {
    var response = http.post(base + '/api/auth/login', { headers: jsonHeaders, body: JSON.stringify({ email: email, password: password }) });
    return response.status === 200 ? json(response.body).token : null;
  }
  function board(token) {
    var response = http.get(base + '/api/feedback?limit=50', { headers: { Authorization: 'Bearer ' + token } });
    return response.status === 200 ? json(response.body).data : null;
  }
  if (output.feedbackMode === 'seed') {
    output.feedbackSeeded = false;
    var stamp = String(new Date().getTime());
    function author(label) {
      var email = 'board-' + label + '-' + stamp + '@fitsy.dev';
      var password = 'Fx-' + stamp + '-Aa1!';
      var registered = http.post(base + '/api/auth/register', { headers: jsonHeaders, body: JSON.stringify({ email: email, password: password, name: 'Board Author ' + label }) });
      if (registered.status !== 200 && registered.status !== 201) return null;
      return json(registered.body).token;
    }
    function post(token, message) {
      var response = http.post(base + '/api/feedback', { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ message: message }) });
      return response.status === 201 ? json(response.body).data.id : null;
    }
    var tokenA = author('A');
    var tokenB = author('B');
    if (!tokenA || !tokenB) return;
    output.messageA = 'Report me ' + stamp;
    output.messageB1 = 'Block me first ' + stamp;
    output.messageB2 = 'Block me second ' + stamp;
    output.idA = post(tokenA, output.messageA);
    output.idB1 = post(tokenB, output.messageB1);
    output.idB2 = post(tokenB, output.messageB2);
    output.feedbackSeeded = !!(output.idA && output.idB1 && output.idB2);
    return;
  }
  // verify: the fixture account no longer sees the reported post or the blocked author's posts.
  output.feedbackVerified = false;
  var token = login(LOGIN_EMAIL, LOGIN_PASSWORD);
  if (!token) return;
  var posts = board(token);
  if (!posts) return;
  var ids = posts.map(function (p) { return p.id; });
  output.feedbackHiddenCount = [output.idA, output.idB1, output.idB2].filter(function (id) { return ids.indexOf(id) === -1; }).length;
  output.feedbackVerified = output.feedbackHiddenCount === 3;
})();
