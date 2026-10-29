-- Run with psql against the intended Supabase target. Catalogs only, no user rows.
-- The transaction itself prevents accidental data or configuration writes.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

-- role_table_grants omits PUBLIC privileges, so inspect the catalog ACLs.
SELECT c.relname AS table_name,
       CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE r.rolname END AS grantee,
       acl.privilege_type, grantor.rolname AS grantor, acl.is_grantable
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
LEFT JOIN pg_roles r ON r.oid = acl.grantee
LEFT JOIN pg_roles grantor ON grantor.oid = acl.grantor
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND (acl.grantee = 0 OR r.rolname IN ('anon', 'authenticated'))
ORDER BY table_name, grantee, privilege_type;

-- PostGIS metadata: object grants alone do not establish schema access.
-- Effective checks include PUBLIC, inherited roles and column-only privileges.
-- RLS is reported separately: schema/object privileges do not prove row access.
SELECT n.nspname AS schema_name, c.relname AS table_name,
       pg_get_userbyid(n.nspowner) AS schema_owner,
       pg_get_userbyid(c.relowner) AS table_owner,
       pg_get_userbyid(e.extowner) AS extension_owner, e.extversion,
       pg_has_role(current_user, n.nspowner, 'USAGE') AS audit_inherits_schema_owner,
       r.rolname AS client_role, c.relrowsecurity AS rls_enabled,
       has_schema_privilege(r.oid, n.oid, 'USAGE') AS schema_usage,
       p.privilege_type,
       has_table_privilege(r.oid, c.oid, p.privilege_type) AS table_privilege,
       CASE WHEN p.privilege_type IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
         THEN has_any_column_privilege(r.oid, c.oid, p.privilege_type)
         ELSE false END AS any_column_privilege
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
JOIN pg_extension e ON e.oid = d.refobjid AND d.refclassid = 'pg_extension'::regclass
CROSS JOIN pg_roles r
CROSS JOIN (
  SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS privilege_type
  UNION ALL SELECT 'MAINTAIN' WHERE current_setting('server_version_num')::int >= 170000
) p
WHERE c.relname = 'spatial_ref_sys' AND e.extname = 'postgis'
  AND r.rolname IN ('anon', 'authenticated')
ORDER BY schema_name, table_name, client_role, privilege_type;

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
