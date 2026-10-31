import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { repository } from '../verify/impact-plan.mjs';

// The same synthetic catalog drives the Debug app and Maestro's independent
// calendar projection. Prices still come from the actual Test Store offering.
export function testStoreArgs() {
  const source = readFileSync(resolve(repository, 'apps/mobile/lib/testStoreFixtures.json'), 'utf8');
  return ['-e', `TEST_STORE_FIXTURES=${JSON.stringify(JSON.parse(source))}`];
}
