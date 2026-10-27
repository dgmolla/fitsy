-- Run with psql against the intended Supabase target. Catalogs only, no user rows.
-- The transaction itself prevents accidental data or configuration writes.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('PUBLIC', 'anon', 'authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

SELECT pg_get_userbyid(d.defaclrole) AS owner_role, n.nspname AS schema_name,
       d.defaclobjtype AS object_type, d.defaclacl AS default_grants
FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
WHERE n.nspname = 'public' OR d.defaclnamespace = 0;

-- Empty expected: Fitsy currently uses external restaurant images, no buckets.
SELECT id, name, public FROM storage.buckets ORDER BY id;
COMMIT;
