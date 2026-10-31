/** Operator-only target validation, never a general production-write override. */
import { databaseTarget, PROD_PROJECT_REF } from '../lib/db-target-guard';

export const AUDIT_ROLE = 'fitsy_audit_readonly';

export function confirmedProdAuditUrl(value: string, confirmation: string): URL {
  if (confirmation !== PROD_PROJECT_REF) throw new Error('PROD confirmation did not match; no database connection was made');
  const target = databaseTarget(value);
  if (target.local || target.ref !== PROD_PROJECT_REF) throw new Error('PROD_DB_ADMIN_URL must target the exact PROD project');
  const url = new URL(target.url);
  const username = decodeURIComponent(url.username);
  if (url.pathname !== '/postgres' || !url.password ||
      !['postgres', `postgres.${PROD_PROJECT_REF}`].includes(username)) {
    throw new Error('PROD_DB_ADMIN_URL must include administrator credentials and the postgres database');
  }
  url.searchParams.set('sslmode', 'require');
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('connect_timeout', '10');
  url.searchParams.set('pool_timeout', '10');
  // Supavisor transaction mode may not support Prisma's named statements.
  if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '6543') url.searchParams.set('pgbouncer', 'true');
  return url;
}
