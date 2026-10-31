import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { TRIAL_CATALOG_POLICY } from '../../packages/shared/src/contracts/trialPolicy';

const helper = resolve(__dirname, '../../apps/mobile/e2e/helpers/mixed-trial-default.mjs');
const fixtureSource = readFileSync(resolve(__dirname, '../../apps/mobile/lib/testStoreFixtures.cjs'), 'utf8');
const fixtureModule = { exports: {} };
runInNewContext(fixtureSource, { module: fixtureModule });
const fixture = fixtureModule.exports;
const { loadAll } = require('js-yaml');

test.each(['paywall-eligible-visual', 'paywall-mixed-trials-visual'])(
  '%s loads its fixture through saved scripts without caller-injected variables', flow => {
    const observations: object[] = [];
    const output: { trialFixture?: object } = {};
    class Clock extends Date {
      constructor(value?: string | number) { super(value ?? '2026-10-31T23:36:00.000Z'); }
    }
    const replay = (path: string, inherited: Record<string, string> = {}) => {
      const [header, commands] = loadAll(readFileSync(path, 'utf8'));
      const env = { ...inherited, ...header.env };
      for (const step of commands) {
        if (step.runScript) {
          runInNewContext(readFileSync(resolve(dirname(path), step.runScript), 'utf8'),
            { ...env, output, Date: Clock, console: { log() {} } });
          if (step.runScript.endsWith('mixed-trial-default.mjs')) observations.push({ ...output.trialFixture });
        }
        if (step.runFlow?.file) replay(resolve(dirname(path), step.runFlow.file), { ...env, ...step.runFlow.env });
      }
    };
    replay(resolve(__dirname, `../../apps/mobile/e2e/flows/${flow}.yaml`));
    expect(observations).toMatchObject(flow === 'paywall-eligible-visual'
      ? [{ plan: 'yearly', name: 'Annual', days: 14 }]
      : [{ shortPlan: 'yearly', shortDays: 2, longDays: 7 }, { shortPlan: 'monthly', shortDays: 2, longDays: 7 }]);
  });

function observe(at: string, scenario: string, timezone = 'America/Los_Angeles') {
  // Execute the exact Maestro script and the real application projections in
  // the same local timezone. Expected dates/plans below are independent facts.
  return JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '-e', `
    const {readFileSync}=require('node:fs');
    const {runInNewContext}=require('node:vm');
    const {devTrialVisualOffer}=require('./apps/mobile/lib/devTrialVisualOffer.ts');
    const {purchaseTerms}=require('./apps/mobile/lib/purchaseTerms.ts');
    const {defaultTrialPlan,trialPresentation}=require('./apps/mobile/lib/trialPresentation.ts');
    const NativeDate=Date;
    class Clock extends NativeDate {
      constructor(value) { super(value === undefined ? ${JSON.stringify(at)} : value); }
      static now() { return new NativeDate(${JSON.stringify(at)}).getTime(); }
    }
    global.Date=Clock;
    const output={};
    runInNewContext(readFileSync(${JSON.stringify(helper)},'utf8'),
      {SCENARIO:${JSON.stringify(scenario)},Date:Clock,output:Object.assign(output,{testStoreFixtures:${JSON.stringify(fixture)}}),console:{log(){}}});
    const pkg=(identifier,subscriptionPeriod)=>({identifier,product:{identifier,priceString:'€12,34',subscriptionPeriod}});
    const annual=pkg('yearly','P1Y'), monthly=pkg('monthly','P1M');
    const visual=devTrialVisualOffer({annual,monthly,availablePackages:[annual,monthly]},true,true,${JSON.stringify(scenario)});
    const terms=plan=>purchaseTerms(visual.offering[plan].product,true);
    const year=terms('annual'), month=terms('monthly');
    const short=year.trialDays===2?year:month;
    const shown=trialPresentation(short);
    process.stdout.write(JSON.stringify({fixture:output.trialFixture,app:{plan:defaultTrialPlan(year,month),
      annualDays:year.trialDays,monthlyDays:month.trialDays,shortReminderAvailable:shown.reminderAvailable,
      reminder:shown.reminderDate?.toISOString()??null,charge:shown.projectedChargeDate.toISOString()}}));
  `], { cwd: resolve(__dirname, '../..'), env: { ...process.env, TZ: timezone, NODE_OPTIONS: '' }, encoding: 'utf8' }));
}

test.each([
  ['2026-10-24T13:02:00-07:00', 'annual-short', 'monthly', 7, false, null, '2026-10-26T20:02:00.000Z'],
  ['2026-10-31T13:02:00-07:00', 'annual-short', 'yearly', 2, true, '2026-10-31T21:02:00.000Z', '2026-11-02T21:02:00.000Z'],
  ['2026-10-31T07:00:00-07:00', 'annual-short', 'monthly', 7, false, null, '2026-11-02T15:00:00.000Z'],
  ['2026-10-31T20:00:00-07:00', 'annual-short', 'monthly', 7, false, null, '2026-11-03T04:00:00.000Z'],
  ['2026-10-31T13:02:00-07:00', 'monthly-short', 'yearly', 7, true, '2026-10-31T21:02:00.000Z', '2026-11-02T21:02:00.000Z'],
  ['2026-03-07T13:02:00-08:00', 'annual-short', 'monthly', 7, false, null, '2026-03-09T20:02:00.000Z'],
] as const)('%s %s keeps the configured default and reminder eligibility', (at, scenario, plan, days, available, reminder, charge) => {
  const result = observe(at, scenario);
  expect(result.fixture).toMatchObject({ plan, days, shortReminderAvailable: available,
    name: plan === 'yearly' ? 'Annual' : 'Monthly', period: plan === 'yearly' ? 'year' : 'month' });
  expect(result.app).toEqual({ plan, annualDays: scenario === 'annual-short' ? 2 : 7,
    monthlyDays: scenario === 'annual-short' ? 7 : 2, shortReminderAvailable: available, reminder, charge });
});

test('UTC has no autumn clock extension and unknown synthetic catalogs fail', () => {
  expect(observe('2026-10-31T13:02:00Z', 'annual-short', 'UTC').fixture).toMatchObject({
    plan: 'monthly', days: 7, shortReminderAvailable: false,
  });
  expect(() => runInNewContext(readFileSync(helper, 'utf8'), { SCENARIO: 'unknown', output: { testStoreFixtures: fixture } })).toThrow('Unknown mixed-trial fixture');
  // Changes to the shared policy must update Maestro's independent oracle too.
  expect(TRIAL_CATALOG_POLICY.reminderLeadHours).toBe(48);
  expect(TRIAL_CATALOG_POLICY.cancellationLeadHours).toBe(24);
});

test('Maestro derives both plan names and changed durations from the supplied fixture', () => {
  const config = JSON.parse(JSON.stringify(fixture));
  config.catalogs['annual-short'] = { yearly: 7, monthly: 14 };
  config.plans.yearly.name = 'Yearly fixture';
  const output: { trialFixture?: object; testStoreFixtures: object } = { testStoreFixtures: config };
  runInNewContext(readFileSync(helper, 'utf8'), {
    SCENARIO: 'annual-short', output, console: { log() {} },
  });
  expect(output.trialFixture).toMatchObject({ plan: 'yearly', name: 'Yearly fixture', days: 7,
    shortPlan: 'yearly', shortDays: 7, longPlan: 'monthly', longDays: 14 });
  expect(config.reminderLeadHours).toBe(TRIAL_CATALOG_POLICY.reminderLeadHours);
  expect(config.cancellationLeadHours).toBe(TRIAL_CATALOG_POLICY.cancellationLeadHours);
});

test('Metro and Maestro load identical catalogs without filesystem or Node globals in Maestro', () => {
  const output: { testStoreFixtures?: object } = {};
  const context = { output };
  runInNewContext(fixtureSource, context);
  expect(output.testStoreFixtures).toEqual(fixture);
  // Mixed catalog flows load the script twice in one Maestro JS context.
  runInNewContext(fixtureSource, context);
  expect(output.testStoreFixtures).toEqual(fixture);
});
