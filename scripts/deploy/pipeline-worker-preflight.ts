import { PrismaClient } from '@prisma/client';
import { assertDevDatabase, assertPipelineDatabase } from '../lib/db-target-guard';
import { cloudEnvironment } from '../pipeline-cloud-worker';
import { cloudReadiness } from '../pipeline-v2/cloud-service';

/** Withhold worker startup on missing secrets/schema, using the actual runtime configuration path. */
async function preflight(): Promise<void> {
  const { url } = await cloudEnvironment();
  const db = new PrismaClient({ datasources: { db: { url: await assertPipelineDatabase(assertDevDatabase(url)) } } });
  try { await cloudReadiness(db); process.stdout.write('Pipeline worker preflight passed\n'); }
  finally { await db.$disconnect(); }
}
void preflight().catch(() => {
  console.error('Pipeline worker preflight failed: configure PIPELINE_DATABASE_URL (DEV pipeline_writer) and TYPESAFE_API_KEY '
    + 'only in the runtime secret store; apply guarded migrations and verify shared rate-limit/budget state. Worker startup withheld.');
  process.exitCode = 1;
});
