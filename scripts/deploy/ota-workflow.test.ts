import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const { load } = require('js-yaml') as { load: (input: string) => unknown };

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
