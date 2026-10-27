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
  if (login.status !== 200) return;
  var token = json(login.body).token;
  if (!token) return;
  var config = { headers: { Authorization: 'Bearer ' + token } };
  var response = http.get(base + '/api/restaurants?lat=34.0407&lng=-118.2468&calories=280&protein=28&carbs=34&fat=5', config);
  output.shuffleApiStatus = response.status;
  if (response.status !== 200) return;
  var search = json(response.body);
  output.shuffleApiUnlocked = search.meta.locked === false;
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
