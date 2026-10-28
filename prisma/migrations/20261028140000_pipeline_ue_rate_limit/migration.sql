BEGIN;

-- Capacity one: next_request_at is the refill time, so idle workers cannot bank a burst.
CREATE TABLE public.pipeline_ue_rate_limit (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK (singleton),
  cap_rps DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (cap_rps >= 0.01 AND cap_rps <= 10),
  effective_rps DOUBLE PRECISION NOT NULL DEFAULT 1 CHECK (effective_rps >= 0.01 AND effective_rps <= cap_rps),
  next_request_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocked_until TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  recover_after TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  requests BIGINT NOT NULL DEFAULT 0 CHECK (requests >= 0),
  waits BIGINT NOT NULL DEFAULT 0 CHECK (waits >= 0),
  throttles BIGINT NOT NULL DEFAULT 0 CHECK (throttles >= 0),
  last_throttle_status INTEGER CHECK (last_throttle_status IN (403, 429)),
  last_throttle_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO public.pipeline_ue_rate_limit (singleton) VALUES (true);

ALTER TABLE public."pipeline_ue_rate_limit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pipeline_ue_rate_limit FROM PUBLIC;
-- Supabase default grants can otherwise expose new operational tables.
DO $acl$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT r.rolname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public' AND c.relname = 'pipeline_ue_rate_limit' AND acl.grantee <> c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.pipeline_ue_rate_limit FROM %I', grantee_name);
  END LOOP;
END
$acl$;
GRANT SELECT, UPDATE ON TABLE public.pipeline_ue_rate_limit TO pipeline_writer;
CREATE POLICY fitsy_pipeline_select ON public.pipeline_ue_rate_limit FOR SELECT TO pipeline_writer USING (true);
CREATE POLICY fitsy_pipeline_update ON public.pipeline_ue_rate_limit FOR UPDATE TO pipeline_writer USING (true) WITH CHECK (true);
GRANT SELECT ON TABLE public.pipeline_ue_rate_limit TO fitsy_audit_readonly;
CREATE POLICY fitsy_audit_select ON public.pipeline_ue_rate_limit FOR SELECT TO fitsy_audit_readonly USING (true);

COMMIT;
