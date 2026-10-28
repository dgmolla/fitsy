// Check direct API access before the mobile SDK can synchronize the fixture.
// Keep credentials and response bodies local, outside Maestro's persisted output.
(function () {
  var base = typeof EXPO_PUBLIC_API_URL === 'string' ? EXPO_PUBLIC_API_URL : '';
  if (!/^https:\/\/(?:dev\.fitsy\.org|fitsy-api-[a-z0-9-]+-dawits-projects-74b6e00f\.vercel\.app)$/.test(base)) {
    throw new Error('Maestro refuses production and unrelated API origins; pass the app EXPO_PUBLIC_API_URL');
  }
  var login = http.post(base + '/api/auth/login', {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
  });
  output.shuffleApiLoginStatus = login.status;
  output.shuffleApiUnlocked = false;
  output.shuffleApiHasDish = false;
  output.shuffleApiHasMacros = false;
  output.shuffleApiVerified = false;
  output.shuffleApiListChanged = false;
  output.shuffleApiValidationStatus = 0;
  output.shuffleApiDeploymentSha = null;
  output.shuffleSearchStatus = 0;
  output.shuffleApiStatus = 0;
  output.shuffleSearchCount = 0;
  output.shuffleResultCount = 0;
  output.shuffleTotal = 0;
  if (login.status !== 200) return;
  var token = json(login.body).token;
  if (!token) return;
  var config = { headers: { Authorization: 'Bearer ' + token } };
  var searchPath = base + '/api/restaurants?lat=34.0407&lng=-118.2468&calories=600&protein=40&carbs=60&fat=20';
  var health = http.get(base + '/api/health');
  var sha = health.status === 200 ? json(health.body).deploymentSha : null;
  output.shuffleApiDeploymentSha = /^[a-f0-9]{40}$/.test(sha || '') ? sha : null;
  // Older search silently ignores shuffle options and returns the same page with HTTP 200.
  // Fail with deployment diagnostics instead of misclassifying it as a broken Shuffle button.
  var validation = http.get(searchPath + '&shuffle=invalid', config);
  output.shuffleApiValidationStatus = validation.status;
  console.log('[shuffle-api] ' + JSON.stringify({ backend: base, deploymentSha: output.shuffleApiDeploymentSha,
    validationStatus: validation.status }));
  if (validation.status !== 400) return;
  var normal = http.get(searchPath, config);
  output.shuffleSearchStatus = normal.status;
  if (normal.status !== 200) return;
  var shown = json(normal.body).data;
  if (!Array.isArray(shown) || !shown.length) return;
  output.shuffleSearchCount = shown.length;
  var shownIds = shown.map(function (row) { return row.id; });
  var response = http.get(searchPath + '&shuffle=1&seed=maestro-before-mobile&excludeRestaurantIds=' + encodeURIComponent(shownIds.join(',')), config);
  output.shuffleApiStatus = response.status;
  if (response.status !== 200) return;
  var search = json(response.body);
  output.shuffleResultCount = Array.isArray(search.data) ? search.data.length : 0;
  output.shuffleTotal = typeof search.meta.total === 'number' ? search.meta.total : 0;
  output.shuffleApiUnlocked = search.meta.locked === false;
  output.shuffleApiListChanged = Array.isArray(search.data) && search.data.length > 0 &&
    search.data.some(function (row) { return shownIds.indexOf(row.id) === -1; });
  output.shuffleApiHasDish = Array.isArray(search.data) && search.data.some(function (row) {
    return !!(row.bestMatch && row.bestMatch.menuItemId);
  });
  output.shuffleApiHasMacros = Array.isArray(search.data) && search.data.some(function (row) {
    return !!(row.bestMatch && typeof row.bestMatch.calories === 'number');
  });
  var status = http.get(base + '/api/subscriptions/status', config);
  if (status.status !== 200) return;
  var proof = json(status.body);
  // A demo bypass alone must not satisfy this subscriber regression.
  output.shuffleApiVerified = proof.active === true && proof.verdict === 'active' && proof.stale === false &&
    !!proof.lastRcVerifiedAt && (proof.status === 'active' || proof.status === 'billing_issue');
})();
