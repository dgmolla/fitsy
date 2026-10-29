BEGIN;

-- Run limits belong to the database, never to an individual replica or invocation.
CREATE TABLE public.pipeline_runs (
  run_id TEXT PRIMARY KEY,
  config JSONB NOT NULL CHECK (jsonb_typeof(config) = 'object'),
  max_hexes INTEGER NOT NULL CHECK (max_hexes BETWEEN 1 AND 1000),
  budget_usd NUMERIC(18,9) NOT NULL CHECK (budget_usd >= 0 AND budget_usd <= 5000),
  charged_usd NUMERIC(18,9) NOT NULL DEFAULT 0 CHECK (charged_usd >= 0),
  reserved_usd NUMERIC(18,9) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'budget_cap', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX pipeline_runs_one_active ON public.pipeline_runs ((true)) WHERE status = 'running';
ALTER TABLE public.pipeline_paid_requests ADD COLUMN run_id TEXT REFERENCES public.pipeline_runs(run_id) ON DELETE RESTRICT;
CREATE INDEX pipeline_paid_requests_run_id ON public.pipeline_paid_requests(run_id);

ALTER TABLE public."pipeline_runs" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pipeline_runs FROM PUBLIC;
DO $acl$
DECLARE grantee_name TEXT;
BEGIN
  FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN LATERAL aclexplode(c.relacl) acl JOIN pg_roles r ON r.oid=acl.grantee
    WHERE n.nspname='public' AND c.relname='pipeline_runs' AND acl.grantee<>c.relowner LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.pipeline_runs FROM %I', grantee_name);
  END LOOP;
END $acl$;
GRANT SELECT, INSERT, UPDATE ON public.pipeline_runs TO pipeline_writer;
CREATE POLICY fitsy_pipeline_write ON public.pipeline_runs FOR ALL TO pipeline_writer USING (true) WITH CHECK (true);
GRANT SELECT ON public.pipeline_runs TO fitsy_audit_readonly;
CREATE POLICY fitsy_audit_select ON public.pipeline_runs FOR SELECT TO fitsy_audit_readonly USING (true);

-- Lock order is always run, then daily service budget, including settlement.
-- The daily reservation and the cumulative run envelope commit or roll back together.
CREATE FUNCTION public.pipeline_run_reserve(p_run TEXT, p_id UUID, p_service TEXT, p_usd NUMERIC, p_scope TEXT)
RETURNS TABLE(id UUID, reason TEXT)
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE run public.pipeline_runs; permit UUID;
BEGIN
  IF p_usd IS NULL OR p_usd < 0 THEN RAISE EXCEPTION 'Invalid run reservation'; END IF;
  SELECT * INTO STRICT run FROM public.pipeline_runs WHERE run_id=p_run FOR UPDATE;
  IF run.status<>'running' THEN RETURN QUERY SELECT NULL::UUID, 'run'::TEXT; RETURN; END IF;
  IF run.charged_usd+p_usd>run.budget_usd THEN
    -- Temporary contention is not a permanent budget stop. In-flight calls may settle for less.
    IF run.reserved_usd=0 THEN
      UPDATE public.pipeline_runs SET status='budget_cap', updated_at=clock_timestamp() WHERE run_id=p_run;
    END IF;
    RETURN QUERY SELECT NULL::UUID, 'run'::TEXT; RETURN;
  END IF;
  permit := public.pipeline_budget_reserve(p_id,p_service,p_usd,p_scope);
  IF permit IS NULL THEN RETURN QUERY SELECT NULL::UUID, 'daily'::TEXT; RETURN; END IF;
  UPDATE public.pipeline_paid_requests SET run_id=p_run WHERE pipeline_paid_requests.id=permit;
  UPDATE public.pipeline_runs SET charged_usd=charged_usd+p_usd, reserved_usd=reserved_usd+p_usd,
    updated_at=clock_timestamp() WHERE run_id=p_run;
  RETURN QUERY SELECT permit, NULL::TEXT;
END $$;

CREATE FUNCTION public.pipeline_run_settle(p_run TEXT, p_id UUID, p_usd NUMERIC, p_throttled BOOLEAN)
RETURNS UUID LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE request public.pipeline_paid_requests;
BEGIN
  IF p_usd < 0 THEN RAISE EXCEPTION 'Invalid run settlement'; END IF;
  PERFORM run_id FROM public.pipeline_runs WHERE run_id=p_run FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing run'; END IF;
  SELECT * INTO STRICT request FROM public.pipeline_paid_requests WHERE id=p_id AND run_id=p_run AND settled_at IS NULL;
  PERFORM public.pipeline_budget_settle(p_id,p_usd,p_throttled);
  UPDATE public.pipeline_runs SET charged_usd=charged_usd+CASE WHEN p_usd IS NULL THEN 0 ELSE p_usd-request.reserved_usd END,
    reserved_usd=reserved_usd-CASE WHEN p_usd IS NULL THEN 0 ELSE request.reserved_usd END,
    updated_at=clock_timestamp() WHERE run_id=p_run;
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION public.pipeline_run_reserve(TEXT, UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pipeline_run_settle(TEXT, UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pipeline_run_reserve(TEXT, UUID, TEXT, NUMERIC, TEXT) TO pipeline_writer;
GRANT EXECUTE ON FUNCTION public.pipeline_run_settle(TEXT, UUID, NUMERIC, BOOLEAN) TO pipeline_writer;

COMMIT;
