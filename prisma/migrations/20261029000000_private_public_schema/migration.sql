-- Fitsy uses Supabase Auth, but serves application data through Prisma.
-- The migration role owns this schema, not Supabase's PostGIS objects.
-- Close client schema access even when extension-owned table grants remain.
-- Server roles already have explicit USAGE from the role-separation migration.
DO $clients$
DECLARE client_role text;
BEGIN
  REVOKE USAGE ON SCHEMA public FROM PUBLIC;
  -- Supabase client roles are absent in a fresh disposable PostgreSQL database.
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE USAGE ON SCHEMA public FROM %I', client_role);
    -- Effective privileges include inherited grants. Never silently accept one.
    IF has_schema_privilege(client_role, 'public', 'USAGE') THEN
      RAISE EXCEPTION 'Client role % retains public schema USAGE; review inherited schema grants with the schema owner', client_role;
    END IF;
  END LOOP;
  -- PostgREST reloads its schema and recycles pooled sessions after commit.
  -- A schema revoke alone cannot invalidate already resolved object names.
  NOTIFY pgrst, 'reload schema';
END
$clients$;
