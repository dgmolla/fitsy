-- Supabase SQL Editor alternative, outside prisma/migrations; run as postgres.
-- Manually confirm the dashboard project is zaxkmjqozvmbifiwbxps before running.
-- Prefer npm run db:provision-prod-readonly -w scripts -- --prod for confirmation,
-- local node:crypto password generation, private URL saving and login verification.
-- Generate 32 random bytes locally, encode as 64 lowercase hex characters, and
-- privately replace the placeholder below. Never commit the completed SQL.
-- Fresh-role-only: an existing role aborts this transaction without rotation.
-- This alternative does not write secrets.env or verify a new login; those
-- acceptance steps must still be completed privately with a PostgreSQL client.
BEGIN;
DO $provision$
DECLARE
  audit_password text := 'REPLACE_WITH_LOCALLY_GENERATED_64_HEX_PASSWORD';
BEGIN
  IF audit_password !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Replace the password placeholder with a locally generated 64-character hex password';
  END IF;
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Provisioning requires the postgres database';
  END IF;
  EXECUTE format('CREATE ROLE fitsy_audit_readonly LOGIN NOINHERIT PASSWORD %L', audit_password);
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'fitsy_audit_readonly'
      AND NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
  ) THEN
    RAISE EXCEPTION 'New audit role has unexpected privileges';
  END IF;
END
$provision$;

-- Shared DEV/PROD grants, outside prisma/migrations; use the guarded provisioners.
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

COMMIT;
