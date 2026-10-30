import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { load } = require('js-yaml') as { load: (input: string) => unknown };

type Step = { name?: string; uses?: string; env?: Record<string, string>; run?: string; with?: Record<string, unknown> };
type Job = { if?: string; environment?: string; steps: Step[]; env?: unknown };
function workflow() {
  return load(readFileSync(resolve(__dirname, '../../.github/workflows/deploy.yml'), 'utf8')) as {
    on: { workflow_dispatch: { inputs: { approve_production_ota: { type: string; default: boolean } } } };
    env?: unknown; jobs: Record<string, Job>;
  };
}

test('release installation cannot inherit repository credentials', () => {
  const workflow = load(readFileSync(resolve(__dirname, '../../.github/workflows/deploy.yml'), 'utf8')) as {
    env?: unknown;
    jobs: { ota: { env?: unknown; steps: { name?: string; uses?: string; env?: unknown; run?: string; with?: Record<string, unknown> }[] } };
  };
  const job = workflow.jobs.ota;
  expect(workflow.env).toBeUndefined();
  expect(job.env).toBeUndefined();
  const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout'))!;
  expect(checkout.with!['persist-credentials']).toBe(false);
  const install = job.steps.find(step => step.name === 'Install release dependencies without release credentials')!;
  expect(install.env).toBeUndefined();
  expect(install.run).toContain('npm ci');
  expect(install.run).toContain('npx --yes eas-cli@18 --version');
  const publish = job.steps.find(step => step.name === 'Publish OTA')!;
  expect(publish.env).toMatchObject({ GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' });
  expect(publish.run).not.toMatch(/npm (ci|install)|npx/);
  expect(job.steps.indexOf(install)).toBeLessThan(job.steps.indexOf(publish));
});

test('manual production shares Verify, serving-source, smoke and native gates with explicit Dawit approval', () => {
  const config = workflow();
  const job = config.jobs['production-ota']!;
  expect(config.on.workflow_dispatch.inputs.approve_production_ota).toMatchObject({ type: 'boolean', default: false });
  expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
  expect(job.if).toContain("github.ref == 'refs/heads/main'");
  expect(job.if).toContain("github.actor == 'dgmolla'");
  expect(job.if).toContain('inputs.approve_production_ota');
  expect(job.environment).toBe('production-native');
  expect(job.env).toBeUndefined();
  const index = (name: string) => job.steps.findIndex(step => step.name === name);
  const install = index('Install release dependencies without release credentials');
  const admission = index('Require approved current main and successful Verify');
  const observe = index('Observe the exact successful Vercel deployment');
  const smoke = index('Prod-safe API smoke');
  const identity = index('Verify serving identity after smoke');
  const publish = index('Publish approved production OTA');
  expect([install, admission, observe, smoke, identity, publish].every(i => i >= 0)).toBe(true);
  expect(install).toBeLessThan(admission);
  expect(admission).toBeLessThan(observe);
  expect(observe).toBeLessThan(smoke);
  expect(smoke).toBeLessThan(identity);
  expect(identity).toBeLessThan(publish);
  expect(job.steps[install]!.env).toBeUndefined();
  expect(job.steps[publish]!.run).toContain('ota.sh --manual-production');
  expect(job.steps.filter(step => step.env?.EXPO_TOKEN)).toEqual([job.steps[publish]]);
});
