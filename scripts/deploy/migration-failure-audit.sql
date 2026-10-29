-- Read-only incident #637 evidence, never permission to resolve a migration.
-- Run the complete file in the production owner's existing SQL connection.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';

SELECT jsonb_build_object(
  'database', current_database(),
  'inspected_at', transaction_timestamp(),
  'migration_history', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', id, 'migration_name', migration_name, 'checksum', checksum,
      'started_at', started_at, 'finished_at', finished_at,
      'rolled_back_at', rolled_back_at, 'applied_steps_count', applied_steps_count,
      'unresolved', finished_at IS NULL AND rolled_back_at IS NULL,
      'failure_logs_present', logs IS NOT NULL,
      'missing_pipeline_writer', logs LIKE '%role "pipeline_writer" does not exist%'
    ) ORDER BY started_at, id)
    FROM public._prisma_migrations
    WHERE migration_name = '20261028130000_hex_jobs'
      OR (finished_at IS NULL AND rolled_back_at IS NULL)
  ), '[]'::jsonb),
  'relations', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', names.name, 'present', c.oid IS NOT NULL,
      'kind', c.relkind, 'owner', pg_get_userbyid(c.relowner),
      'rls', c.relrowsecurity, 'acl', c.relacl::text
    ) ORDER BY names.name)
    FROM (VALUES ('hex_jobs'), ('hex_job_events')) AS names(name)
    LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || names.name)
  ),
  'roles', (
    SELECT jsonb_agg(jsonb_build_object(
      'name', names.name, 'present', r.oid IS NOT NULL
    ) ORDER BY names.name)
    FROM (VALUES ('fitsy_app'), ('pipeline_writer'), ('fitsy_audit_readonly')) AS names(name)
    LEFT JOIN pg_roles r ON r.rolname = names.name
  )
) AS migration_failure_audit;

ROLLBACK;
