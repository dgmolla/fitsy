BEGIN;

CREATE TABLE public.pipeline_service_budgets (
  service TEXT PRIMARY KEY CHECK (service IN ('jev', 'google', 'pdf_finder')),
  daily_usd NUMERIC(18,9) NOT NULL CHECK (daily_usd >= 0),
  daily_calls BIGINT NOT NULL CHECK (daily_calls >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Finite DEV defaults. Only an explicit operator configuration changes these.
INSERT INTO public.pipeline_service_budgets (service, daily_usd, daily_calls)
VALUES ('jev', 5, 100000), ('google', 5, 1000), ('pdf_finder', 0, 10);

CREATE TABLE public.pipeline_service_days (
  service TEXT NOT NULL REFERENCES public.pipeline_service_budgets(service) ON DELETE RESTRICT ON UPDATE CASCADE,
  day DATE NOT NULL,
  charged_usd NUMERIC(18,9) NOT NULL DEFAULT 0 CHECK (charged_usd >= 0),
  reserved_usd NUMERIC(18,9) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  calls BIGINT NOT NULL DEFAULT 0 CHECK (calls >= 0),
  throttles BIGINT NOT NULL DEFAULT 0 CHECK (throttles >= 0),
  PRIMARY KEY (service, day)
);

CREATE TABLE public.pipeline_paid_requests (
  id UUID PRIMARY KEY,
  service TEXT NOT NULL REFERENCES public.pipeline_service_budgets(service) ON DELETE RESTRICT ON UPDATE CASCADE,
  day DATE NOT NULL,
  scope TEXT NOT NULL,
  reserved_usd NUMERIC(18,9) NOT NULL CHECK (reserved_usd >= 0),
  cost_usd NUMERIC(18,9) CHECK (cost_usd >= 0),
  throttled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TIMESTAMPTZ
);
CREATE INDEX pipeline_paid_requests_service_day ON public.pipeline_paid_requests(service, day);
CREATE INDEX pipeline_paid_requests_unsettled ON public.pipeline_paid_requests(service) WHERE settled_at IS NULL;

-- The service row serializes configuration, claim admission, reservations and settlement.
-- Sample UTC date after acquiring that lock, including when waiting across midnight.
CREATE FUNCTION public.pipeline_budget_available(p_service TEXT, p_usd NUMERIC) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE budget public.pipeline_service_budgets; today DATE; charged NUMERIC; calls BIGINT;
BEGIN
  IF p_usd IS NULL OR p_usd < 0 THEN RAISE EXCEPTION 'Invalid budget reservation'; END IF;
  SELECT * INTO STRICT budget FROM public.pipeline_service_budgets WHERE service = p_service FOR UPDATE;
  today := (clock_timestamp() AT TIME ZONE 'UTC')::date;
  SELECT COALESCE(SUM(CASE WHEN day=today THEN charged_usd ELSE reserved_usd END),0),
    COALESCE(SUM(calls) FILTER (WHERE day=today),0) INTO charged,calls
    FROM public.pipeline_service_days WHERE service=p_service AND (day=today OR reserved_usd>0);
  RETURN charged + p_usd <= budget.daily_usd AND calls < budget.daily_calls;
END $$;

CREATE FUNCTION public.pipeline_budget_reserve(p_id UUID, p_service TEXT, p_usd NUMERIC, p_scope TEXT) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
  -- No replay of transport permits. Replayed responses are read from their existing journal.
  IF NOT public.pipeline_budget_available(p_service, p_usd) THEN RETURN NULL; END IF;
  INSERT INTO public.pipeline_paid_requests(id, service, day, scope, reserved_usd)
    VALUES (p_id, p_service, (clock_timestamp() AT TIME ZONE 'UTC')::date, p_scope, p_usd);
  INSERT INTO public.pipeline_service_days(service,day,charged_usd,reserved_usd,calls)
    SELECT p_service,day,p_usd,p_usd,1 FROM public.pipeline_paid_requests WHERE id=p_id
    ON CONFLICT(service,day) DO UPDATE SET charged_usd=pipeline_service_days.charged_usd+p_usd,
      reserved_usd=pipeline_service_days.reserved_usd+p_usd,calls=pipeline_service_days.calls+1;
  RETURN p_id;
END $$;

CREATE FUNCTION public.pipeline_budget_settle(p_id UUID, p_usd NUMERIC, p_throttled BOOLEAN) RETURNS UUID
LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE request public.pipeline_paid_requests;
BEGIN
  IF p_usd < 0 THEN RAISE EXCEPTION 'Invalid budget settlement'; END IF;
  PERFORM b.service FROM public.pipeline_service_budgets b JOIN public.pipeline_paid_requests r ON r.service=b.service
    WHERE r.id=p_id FOR UPDATE OF b;
  SELECT * INTO STRICT request FROM public.pipeline_paid_requests WHERE id=p_id AND settled_at IS NULL;
  UPDATE public.pipeline_service_days SET
    charged_usd=charged_usd+CASE WHEN p_usd IS NULL THEN 0 ELSE p_usd-request.reserved_usd END,
    reserved_usd=reserved_usd-CASE WHEN p_usd IS NULL THEN 0 ELSE request.reserved_usd END,
    throttles=throttles+CASE WHEN p_throttled AND NOT request.throttled THEN 1 ELSE 0 END
    WHERE service=request.service AND day=request.day;
  IF NOT FOUND THEN RAISE EXCEPTION 'Missing daily accounting'; END IF;
  UPDATE public.pipeline_paid_requests SET cost_usd=p_usd, throttled=throttled OR p_throttled,
    settled_at=CASE WHEN p_usd IS NULL THEN NULL ELSE clock_timestamp() END WHERE id=p_id;
  RETURN p_id;
END $$;

ALTER TABLE public."pipeline_service_budgets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pipeline_service_days" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."pipeline_paid_requests" ENABLE ROW LEVEL SECURITY;
DO $acl$
DECLARE relation_name TEXT; grantee_name TEXT;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['pipeline_service_budgets', 'pipeline_service_days', 'pipeline_paid_requests'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', relation_name);
    FOR grantee_name IN SELECT DISTINCT r.rolname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) acl JOIN pg_roles r ON r.oid=acl.grantee
      WHERE n.nspname='public' AND c.relname=relation_name AND acl.grantee<>c.relowner LOOP
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', relation_name, grantee_name);
    END LOOP;
    EXECUTE format('GRANT SELECT, UPDATE ON public.%I TO pipeline_writer', relation_name);
    EXECUTE format('CREATE POLICY fitsy_pipeline_select ON public.%I FOR SELECT TO pipeline_writer USING (true)', relation_name);
    EXECUTE format('CREATE POLICY fitsy_pipeline_update ON public.%I FOR UPDATE TO pipeline_writer USING (true) WITH CHECK (true)', relation_name);
    EXECUTE format('GRANT SELECT ON public.%I TO fitsy_audit_readonly', relation_name);
    EXECUTE format('CREATE POLICY fitsy_audit_select ON public.%I FOR SELECT TO fitsy_audit_readonly USING (true)', relation_name);
  END LOOP;
END $acl$;
GRANT INSERT ON public.pipeline_paid_requests, public.pipeline_service_days TO pipeline_writer;
CREATE POLICY fitsy_pipeline_insert ON public.pipeline_service_days FOR INSERT TO pipeline_writer WITH CHECK (true);
CREATE POLICY fitsy_pipeline_insert ON public.pipeline_paid_requests FOR INSERT TO pipeline_writer WITH CHECK (true);
REVOKE ALL ON FUNCTION public.pipeline_budget_available(TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pipeline_budget_reserve(UUID, TEXT, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pipeline_budget_available(TEXT, NUMERIC) TO pipeline_writer;
GRANT EXECUTE ON FUNCTION public.pipeline_budget_reserve(UUID, TEXT, NUMERIC, TEXT) TO pipeline_writer;

REVOKE ALL ON FUNCTION public.pipeline_budget_settle(UUID, NUMERIC, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pipeline_budget_settle(UUID, NUMERIC, BOOLEAN) TO pipeline_writer;

COMMIT;
