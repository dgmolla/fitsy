BEGIN;

CREATE TABLE public.pipeline_pdf_jobs (
  brand_id TEXT PRIMARY KEY REFERENCES public."Brand"(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  next_retry_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ(3),
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (attempts <= max_attempts),
  CHECK ((status = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (status <> 'running' AND lease_owner IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX pipeline_pdf_jobs_status_next_retry_at_idx ON public.pipeline_pdf_jobs (status, next_retry_at);

CREATE TABLE public.pipeline_pdf_events (
  brand_id TEXT NOT NULL REFERENCES public.pipeline_pdf_jobs(brand_id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt BETWEEN 1 AND 3),
  event TEXT NOT NULL,
  payload JSONB NOT NULL,
  PRIMARY KEY (brand_id, attempt, event)
);

ALTER TABLE public."pipeline_pdf_jobs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pipeline_pdf_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pipeline_pdf_jobs, public.pipeline_pdf_events FROM PUBLIC;
DO $acl$
DECLARE grantee_name text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT r.rolname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public' AND c.relname IN ('pipeline_pdf_jobs', 'pipeline_pdf_events') AND acl.grantee <> c.relowner
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.pipeline_pdf_jobs, public.pipeline_pdf_events FROM %I', grantee_name);
  END LOOP;
END
$acl$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pipeline_pdf_jobs TO pipeline_writer;
GRANT SELECT, INSERT ON TABLE public.pipeline_pdf_events TO pipeline_writer;
CREATE POLICY fitsy_pipeline_write ON public.pipeline_pdf_jobs FOR ALL TO pipeline_writer USING (true) WITH CHECK (true);
CREATE POLICY fitsy_pipeline_write ON public.pipeline_pdf_events FOR ALL TO pipeline_writer USING (true) WITH CHECK (true);
GRANT SELECT ON TABLE public.pipeline_pdf_jobs, public.pipeline_pdf_events TO fitsy_audit_readonly;
CREATE POLICY fitsy_audit_select ON public.pipeline_pdf_jobs FOR SELECT TO fitsy_audit_readonly USING (true);
CREATE POLICY fitsy_audit_select ON public.pipeline_pdf_events FOR SELECT TO fitsy_audit_readonly USING (true);

COMMIT;
