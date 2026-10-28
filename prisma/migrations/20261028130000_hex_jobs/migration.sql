BEGIN;

CREATE TABLE public.hex_jobs (
  run_id TEXT NOT NULL,
  hex_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 100),
  next_retry_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checkpoint JSONB NOT NULL DEFAULT '{"version":1,"sequence":0}' CHECK (jsonb_typeof(checkpoint) = 'object'),
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ(3),
  priority INTEGER NOT NULL DEFAULT 0,
  cap_usd DOUBLE PRECISION NOT NULL DEFAULT 5 CHECK (cap_usd >= 0 AND cap_usd <= 5),
  last_error TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, hex_id),
  CHECK (attempts <= max_attempts),
  CHECK ((status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX hex_jobs_run_id_status_priority_next_retry_at_idx
  ON public.hex_jobs (run_id, status, priority DESC, next_retry_at);
CREATE INDEX hex_jobs_status_lease_expires_at_idx ON public.hex_jobs (status, lease_expires_at);

CREATE TABLE public.hex_job_events (
  run_id TEXT NOT NULL,
  hex_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event JSONB NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  PRIMARY KEY (run_id, hex_id, sequence),
  FOREIGN KEY (run_id, hex_id) REFERENCES public.hex_jobs (run_id, hex_id) ON DELETE CASCADE
);

ALTER TABLE public."hex_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."hex_job_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hex_jobs, public.hex_job_events FROM PUBLIC;
-- Supabase projects can have platform default grants. Remove every non-owner ACL.
DO $acl$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT r.rolname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public' AND c.relname IN ('hex_jobs', 'hex_job_events') AND acl.grantee <> c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.hex_jobs, public.hex_job_events FROM %I', grantee_name);
  END LOOP;
END
$acl$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.hex_jobs TO pipeline_writer;
GRANT SELECT, INSERT ON TABLE public.hex_job_events TO pipeline_writer;
CREATE POLICY fitsy_pipeline_write ON public.hex_jobs FOR ALL TO pipeline_writer USING (true) WITH CHECK (true);
CREATE POLICY fitsy_pipeline_write ON public.hex_job_events FOR ALL TO pipeline_writer USING (true) WITH CHECK (true);
GRANT SELECT ON TABLE public.hex_jobs, public.hex_job_events TO fitsy_audit_readonly;
CREATE POLICY fitsy_audit_select ON public.hex_jobs FOR SELECT TO fitsy_audit_readonly USING (true);
CREATE POLICY fitsy_audit_select ON public.hex_job_events FOR SELECT TO fitsy_audit_readonly USING (true);

COMMIT;
