// Check direct API access before the mobile SDK can synchronize the fixture.
// Keep credentials and response bodies local, outside Maestro's persisted output.
(function () {
  var base = 'https://dev.fitsy.org';
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
  if (login.status !== 200) return;
  var token = json(login.body).token;
  if (!token) return;
  var config = { headers: { Authorization: 'Bearer ' + token } };
  var searchPath = base + '/api/restaurants?lat=34.0407&lng=-118.2468&calories=600&protein=40&carbs=60&fat=20';
  var normal = http.get(searchPath, config);
  output.shuffleSearchStatus = normal.status;
  if (normal.status !== 200) return;
  var shown = json(normal.body).data;
  if (!Array.isArray(shown) || !shown.length) return;
  var shownIds = shown.map(function (row) { return row.id; });
  var response = http.get(searchPath + '&shuffle=1&seed=maestro-before-mobile&excludeRestaurantIds=' + encodeURIComponent(shownIds.join(',')), config);
  output.shuffleApiStatus = response.status;
  if (response.status !== 200) return;
  var search = json(response.body);
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
