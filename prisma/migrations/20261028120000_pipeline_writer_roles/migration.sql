-- Credentials are provisioned separately. New roles cannot log in until then.
-- The table owner remains the deploy administrator, never an application role.
BEGIN;

DO $roles$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['fitsy_app', 'pipeline_writer', 'fitsy_audit_readonly']
  LOOP
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN NOINHERIT', role_name);
    END IF;
    -- Preserve an existing DEV audit password, but refuse unsafe pre-existing roles.
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = role_name AND
      (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls))
      OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = role_name)
      OR EXISTS (SELECT FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
        WHERE m.roleid = (SELECT oid FROM pg_roles WHERE rolname = role_name)
          AND r.rolname <> current_user AND r.rolname <> 'supabase_admin' AND NOT r.rolsuper)
      OR EXISTS (SELECT FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = role_name)
      OR EXISTS (SELECT FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = role_name)
      OR EXISTS (SELECT FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba WHERE r.rolname = role_name)
    THEN
      RAISE EXCEPTION 'Unsafe existing database role: %', role_name;
    END IF;
  END LOOP;
END
$roles$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM fitsy_app, pipeline_writer, fitsy_audit_readonly;
GRANT USAGE ON SCHEMA public TO fitsy_app, pipeline_writer, fitsy_audit_readonly;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM fitsy_app, pipeline_writer, fitsy_audit_readonly;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM fitsy_app, pipeline_writer, fitsy_audit_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM fitsy_app, pipeline_writer, fitsy_audit_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM fitsy_app, pipeline_writer, fitsy_audit_readonly;

DO $grants$
DECLARE
  table_name text;
  grantee_name text;
  column_grant record;
  protected_tables text[] := ARRAY['Restaurant', 'Brand', 'ChainItem', 'MenuItem', 'MacroEstimate', 'PipelineCompletedHex'];
  app_tables text[] := ARRAY['User', 'MacroTarget', 'SavedItem', 'Subscription', 'Feedback', 'FeedbackVote', 'LaunchWaitlist', 'MarketingSend'];
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO fitsy_app, pipeline_writer, fitsy_audit_readonly', current_database());
  FOREACH table_name IN ARRAY protected_tables
  LOOP
    -- Remove existing direct grants, including Supabase service_role grants.
    -- Owners/superusers remain administrators and must never be runtime credentials.
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    FOR grantee_name IN
      SELECT DISTINCT r.rolname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) acl JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public' AND c.relname = table_name AND acl.grantee <> c.relowner
    LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, grantee_name);
    END LOOP;
    -- Column ACLs survive a table-level REVOKE, so remove those as well.
    FOR column_grant IN
      SELECT a.attname, acl.privilege_type, acl.grantee, r.rolname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      CROSS JOIN LATERAL aclexplode(a.attacl) acl LEFT JOIN pg_roles r ON r.oid = acl.grantee
      WHERE n.nspname = 'public' AND c.relname = table_name AND acl.grantee <> c.relowner
    LOOP
      EXECUTE format('REVOKE %s (%I) ON TABLE public.%I FROM %s', column_grant.privilege_type,
        column_grant.attname, table_name, CASE WHEN column_grant.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(column_grant.rolname) END);
    END LOOP;
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO fitsy_app, pipeline_writer', table_name);
    EXECUTE format('GRANT INSERT, UPDATE, DELETE ON TABLE public.%I TO pipeline_writer', table_name);
    EXECUTE format('CREATE POLICY fitsy_app_select ON public.%I FOR SELECT TO fitsy_app USING (true)', table_name);
    EXECUTE format('CREATE POLICY fitsy_pipeline_write ON public.%I FOR ALL TO pipeline_writer USING (true) WITH CHECK (true)', table_name);
  END LOOP;
  FOREACH table_name IN ARRAY app_tables
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO fitsy_app', table_name);
    EXECUTE format('CREATE POLICY fitsy_app_write ON public.%I FOR ALL TO fitsy_app USING (true) WITH CHECK (true)', table_name);
  END LOOP;
  -- Prevent the platform's default DML grants from reappearing on future tables.
  FOR grantee_name IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'service_role')
  LOOP
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', grantee_name);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', grantee_name);
  END LOOP;
END
$grants$;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO fitsy_audit_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO fitsy_audit_readonly;
ALTER ROLE fitsy_audit_readonly SET default_transaction_read_only = on;
ALTER ROLE fitsy_audit_readonly SET statement_timeout = '15s';
ALTER ROLE fitsy_audit_readonly SET search_path = pg_catalog, public;

DO $audit$
DECLARE tbl record;
BEGIN
  FOR tbl IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity
  LOOP
    EXECUTE format('CREATE POLICY fitsy_audit_select ON public.%I FOR SELECT TO fitsy_audit_readonly USING (true)', tbl.tablename);
  END LOOP;
END
$audit$;

COMMIT;
