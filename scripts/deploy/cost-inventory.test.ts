import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');
const inventory = JSON.parse(readFileSync(resolve(root, 'docs/engineering/devops/cost-inventory.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(root, 'scripts/deploy/env-manifest.json'), 'utf8'));

// #994: a service that appears in the environment manifest must be in the cost inventory, so a new paid
// integration cannot be added without a recorded plan, pricing page and quota to watch.
test('every environment variable prefix in the manifest is a listed service or an explicit non-service', () => {
  const names = new Set<string>();
  for (const value of Object.values(manifest)) {
    if (Array.isArray(value)) value.forEach(name => typeof name === 'string' && names.add(name));
    else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach(list => Array.isArray(list) && list.forEach(name => typeof name === 'string' && names.add(name)));
  }
  const known = new Set<string>([...inventory.services.flatMap((service: { envPrefixes: string[] }) => service.envPrefixes), ...inventory.notServices]);
  const unknown = [...names].map(name => name.split('_')[0] ?? name).filter(prefix => !known.has(prefix));
  expect([...new Set(unknown)]).toEqual([]);
});

test('every listed service has a plan, an official pricing link, a quota to watch and a monitor entry', () => {
  for (const service of inventory.services) {
    expect(service.plan).toBeTruthy();
    expect(service.pricing).toMatch(/^https:\/\//);
    expect(service.watch).toBeTruthy();
    expect(service.monitor).toBeTruthy();
  }
});
