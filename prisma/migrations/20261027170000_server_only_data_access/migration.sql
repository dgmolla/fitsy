-- Application data is served by the authenticated Next.js API through Prisma.
-- Supabase Auth remains public; its clients need no direct public-schema access.
-- No client policies: RLS denies all anon/authenticated row access by default.
ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MacroTarget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."SavedItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."FeedbackVote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."LaunchWaitlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MarketingSend" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Restaurant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Brand" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ChainItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MenuItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."MacroEstimate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PipelineCompletedHex" ENABLE ROW LEVEL SECURITY;

-- These operational tables can also exist outside the Prisma model inventory.
ALTER TABLE IF EXISTS public."_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public."_marketing_send" ENABLE ROW LEVEL SECURITY;
CREATE TABLE IF NOT EXISTS public."_review_watch" (key text PRIMARY KEY, value text, updated_at timestamptz DEFAULT now());
ALTER TABLE public."_review_watch" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- Supabase roles do not exist in the disposable Postgres verification image.
-- Never create or broaden roles here, and preserve server/service-role access.
DO $$
DECLARE client_role text;
BEGIN
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')
  LOOP
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', client_role);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', client_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', client_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', client_role);
  END LOOP;
END $$;
