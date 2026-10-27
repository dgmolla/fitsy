-- DEV only, outside prisma/migrations. Apply through provision-audit-role.ts.
-- The caller creates a fresh LOGIN NOINHERIT role and verifies unprivileged defaults.
-- Supabase postgres cannot ALTER superuser/replication attributes, even to false.
ALTER ROLE fitsy_audit_readonly SET default_transaction_read_only = on;
ALTER ROLE fitsy_audit_readonly SET statement_timeout = '15s';
ALTER ROLE fitsy_audit_readonly SET search_path = pg_catalog, public;
GRANT CONNECT ON DATABASE postgres TO fitsy_audit_readonly;
GRANT USAGE ON SCHEMA public TO fitsy_audit_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM fitsy_audit_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM fitsy_audit_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fitsy_audit_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT ON TABLES TO fitsy_audit_readonly;
-- RLS remains enabled. Only this role receives SELECT policies, never clients.
DO $audit$
DECLARE tbl record;
BEGIN
  FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity
  LOOP
    EXECUTE format('CREATE POLICY fitsy_dev_audit_select ON public.%I FOR SELECT TO fitsy_audit_readonly USING (true)', tbl.tablename);
  END LOOP;
END
$audit$;
