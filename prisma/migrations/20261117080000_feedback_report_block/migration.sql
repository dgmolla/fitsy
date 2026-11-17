CREATE TABLE public."FeedbackReport" (
  "id" TEXT NOT NULL,
  "feedbackId" TEXT NOT NULL,
  "reporterId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FeedbackReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FeedbackReport_feedbackId_fkey" FOREIGN KEY ("feedbackId") REFERENCES public."Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "FeedbackReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "FeedbackReport_feedbackId_reporterId_key" ON public."FeedbackReport"("feedbackId", "reporterId");
CREATE INDEX "FeedbackReport_feedbackId_idx" ON public."FeedbackReport"("feedbackId");
ALTER TABLE public."FeedbackReport" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."FeedbackReport" FROM PUBLIC;
DO $$
DECLARE client_role text;
BEGIN
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'pipeline_writer') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public."FeedbackReport" FROM %I', client_role);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."FeedbackReport" TO fitsy_app;
CREATE POLICY fitsy_app_write ON public."FeedbackReport" FOR ALL TO fitsy_app USING (true) WITH CHECK (true);

CREATE TABLE public."UserBlock" (
  "id" TEXT NOT NULL,
  "blockerId" TEXT NOT NULL,
  "blockedId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON public."UserBlock"("blockerId", "blockedId");
CREATE INDEX "UserBlock_blockedId_idx" ON public."UserBlock"("blockedId");
ALTER TABLE public."UserBlock" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."UserBlock" FROM PUBLIC;
DO $$
DECLARE client_role text;
BEGIN
  FOR client_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated', 'pipeline_writer') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public."UserBlock" FROM %I', client_role);
  END LOOP;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."UserBlock" TO fitsy_app;
CREATE POLICY fitsy_app_write ON public."UserBlock" FOR ALL TO fitsy_app USING (true) WITH CHECK (true);
