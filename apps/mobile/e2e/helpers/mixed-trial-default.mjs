// Maestro's local clock follows the simulator's host timezone.
// These are synthetic trial periods on live prices, not RevenueCat catalog edits.
(function () {
  if (SCENARIO !== 'annual-short' && SCENARIO !== 'monthly-short') {
    throw new Error('Unknown mixed-trial fixture');
  }
  var days = SCENARIO === 'annual-short' ? { yearly: 2, monthly: 7 } : { yearly: 7, monthly: 2 };
  var now = new Date();
  function schedulable(plan) {
    // Store trial days are calendar days; the reminder lead is 48 elapsed hours.
    // A two-day trial can span 49 hours at the autumn clock change.
    var charge = new Date(now.getTime());
    charge.setDate(charge.getDate() + days[plan]);
    var reminder = new Date(charge.getTime() - 48 * 60 * 60 * 1000);
    if (reminder.getHours() >= 20) reminder.setHours(19, 0, 0, 0);
    else if (reminder.getHours() < 9) {
      reminder.setDate(reminder.getDate() - 1);
      reminder.setHours(19, 0, 0, 0);
    }
    return reminder > now && charge.getTime() - reminder.getTime() >= 24 * 60 * 60 * 1000;
  }
  var plan = schedulable('yearly') || !schedulable('monthly') ? 'yearly' : 'monthly';
  output.trialFixture = {
    plan: plan, name: plan === 'yearly' ? 'Annual' : 'Monthly',
    days: days[plan], period: plan === 'yearly' ? 'year' : 'month',
    shortReminderAvailable: schedulable(SCENARIO === 'annual-short' ? 'yearly' : 'monthly'),
    observedAt: now.toISOString(), timezoneOffset: now.getTimezoneOffset(),
  };
  console.log('[mixed-trial-fixture] ' + JSON.stringify(output.trialFixture));
})();
