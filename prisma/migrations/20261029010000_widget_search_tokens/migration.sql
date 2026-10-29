CREATE TABLE public."WidgetToken" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WidgetToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WidgetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WidgetToken_tokenHash_key" ON public."WidgetToken"("tokenHash");
CREATE UNIQUE INDEX "WidgetToken_userId_installationId_key" ON public."WidgetToken"("userId", "installationId");
ALTER TABLE public."WidgetToken" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."WidgetToken" FROM PUBLIC;
DO $$
DECLARE client_role text;
BEGIN
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'pipeline_writer') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public."WidgetToken" FROM %I', client_role);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."WidgetToken" TO fitsy_app;
CREATE POLICY fitsy_app_write ON public."WidgetToken" FOR ALL TO fitsy_app USING (true) WITH CHECK (true);
