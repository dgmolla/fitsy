// Maestro's local clock follows the simulator's host timezone.
// These are synthetic trial periods on live prices, not RevenueCat catalog edits.
(function () {
  var config = JSON.parse(TEST_STORE_FIXTURES);
  var days = config.catalogs[SCENARIO];
  if (config.version !== 1 || !days) {
    throw new Error('Unknown mixed-trial fixture');
  }
  var now = new Date();
  function reminderFor(plan) {
    // Store trial days are calendar days; the reminder lead is 48 elapsed hours.
    // A two-day trial can span 49 hours at the autumn clock change.
    var charge = new Date(now.getTime());
    charge.setDate(charge.getDate() + days[plan]);
    var reminder = new Date(charge.getTime() - config.reminderLeadHours * 60 * 60 * 1000);
    if (reminder.getHours() >= 20) reminder.setHours(19, 0, 0, 0);
    else if (reminder.getHours() < 9) {
      reminder.setDate(reminder.getDate() - 1);
      reminder.setHours(19, 0, 0, 0);
    }
    return reminder > now && charge.getTime() - reminder.getTime() >= config.cancellationLeadHours * 60 * 60 * 1000 ? reminder : null;
  }
  function schedulable(plan) { return reminderFor(plan) !== null; }
  var plan = schedulable('yearly') || !schedulable('monthly') ? 'yearly' : 'monthly';
  var shortPlan = days.yearly < days.monthly ? 'yearly' : 'monthly';
  var longPlan = shortPlan === 'yearly' ? 'monthly' : 'yearly';
  var reminder = reminderFor(plan);
  function day(date) { return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); }
  output.trialFixture = {
    plan: plan, name: config.plans[plan].name,
    days: days[plan], period: config.plans[plan].period,
    shortPlan: shortPlan, shortDays: days[shortPlan], shortPeriod: config.plans[shortPlan].period,
    longPlan: longPlan, longDays: days[longPlan], longPeriod: config.plans[longPlan].period,
    shortReminderAvailable: schedulable(shortPlan),
    reminderDays: reminder ? Math.round((day(reminder) - day(now)) / 86400000) : null,
    observedAt: now.toISOString(), timezoneOffset: now.getTimezoneOffset(),
  };
  console.log('[mixed-trial-fixture] ' + JSON.stringify(output.trialFixture));
})();
