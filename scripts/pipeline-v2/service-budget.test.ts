import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseBudgetOptions } from './service-budget';

test('the operator configures global daily caps, including a zero-cost finder call cap', () => {
  expect(parseBudgetOptions(['budgets'])).toBeUndefined();
  expect(parseBudgetOptions(['budgets','--service=pdf_finder','--daily-usd=0','--daily-calls=10'])).toEqual({ service:'pdf_finder',usd:0,calls:10 });
});
test.each([
  ['--service=jev'],['--service=unbounded','--daily-usd=5','--daily-calls=100'],
  ['--service=google','--daily-usd=-1','--daily-calls=100'],['--service=google','--daily-usd=NaN','--daily-calls=100'],
  ['--service=jev','--daily-usd=5','--daily-calls=0.5'],['--service=jev','--daily-usd=5','--daily-calls=Infinity'],
  ['--service=jev','--daily-usd=5','--daily-calls=100','--service=jev'],['--reset=true'],
])('invalid budget settings fail before database/provider access: %j', (...args) => {
  expect(() => parseBudgetOptions(['budgets',...args])).toThrow();
});
test('the guarded CLI refuses malformed budget settings before requiring credentials', () => {
  const result = spawnSync('npm',['run','preload:v2:dev','--','budgets','--service=jev','--daily-usd=-1','--daily-calls=10'],
    { cwd:resolve(__dirname,'../..'),encoding:'utf8',timeout:30000,env:{ PATH:process.env.PATH,HOME:process.env.HOME } });
  expect(result.status).toBe(1); expect(result.stderr).toContain('Invalid daily service cap');
});

test('the existing CLI prints a deployable dashboard without requiring database credentials', () => {
  const result = spawnSync(process.execPath,['--import','tsx','scripts/preload-v2.ts','dashboard'],
    { cwd:resolve(__dirname,'../..'),encoding:'utf8',timeout:30000,env:{ PATH:process.env.PATH,HOME:process.env.HOME } });
  expect(result.status).toBe(0); expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject({ name:'Pipeline v2 budgets and coverage',schemaVersion:2 });
});
