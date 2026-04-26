-- ─────────────────────────────────────────────────────────────────────────────
-- PARKED RLS migration — DO NOT APPLY without re-evaluating the decision below.
--
-- Status: drafted 2026-04-25, decided NOT to apply 2026-04-25.
-- Originally lived at: prisma/migrations/20260425000001_rls_policies/migration.sql
-- Moved here to keep it out of Prisma's auto-discovery path.
--
-- Decision: today's posture (RLS enabled, zero policies, API uses service_role)
-- is already secure. Applying the policies below would *open* anon-key read
-- access on Restaurant/MenuItem/MacroEstimate via PostgREST — a regression vs.
-- current default-deny behavior, and it would expose paid pipeline output to
-- anyone with the (public-by-design) anon key from the mobile bundle.
--
-- When to revisit: only if/when we route traffic through anon or authenticated
-- Postgres roles directly (Supabase realtime, edge SSR with anon, per-user JWT
-- migration making RLS load-bearing). At that point this becomes the starting
-- point for an Option B that's actually load-bearing.
--
-- Background and full reasoning: docs/engineering/backend/perf-and-security-handoff-2026-04-25.md
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Public discovery data ──────────────────────────────────────────────────

CREATE POLICY "Restaurant_anon_select"
  ON "Restaurant" FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "MenuItem_anon_select"
  ON "MenuItem" FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "MacroEstimate_anon_select"
  ON "MacroEstimate" FOR SELECT TO anon, authenticated USING (true);

-- ─── User-scoped data ───────────────────────────────────────────────────────
-- User.id stores the UUID provided by Supabase auth.users.id (typed as
-- String in Prisma). Comparing to auth.uid()::text is the canonical
-- Supabase pattern.

CREATE POLICY "User_self_select"
  ON "User" FOR SELECT TO authenticated
  USING (id = auth.uid()::text);

CREATE POLICY "User_self_update"
  ON "User" FOR UPDATE TO authenticated
  USING (id = auth.uid()::text)
  WITH CHECK (id = auth.uid()::text);

CREATE POLICY "MacroTarget_self_all"
  ON "MacroTarget" FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "SavedItem_self_all"
  ON "SavedItem" FOR ALL TO authenticated
  USING ("userId" = auth.uid()::text)
  WITH CHECK ("userId" = auth.uid()::text);

CREATE POLICY "Subscription_self_select"
  ON "Subscription" FOR SELECT TO authenticated
  USING ("userId" = auth.uid()::text);

-- ─── Pipeline tables: no policy = default deny ──────────────────────────────
-- PipelineCompletedHex and _prisma_migrations stay locked down for non-
-- service-role connections. Service role bypasses RLS and continues to
-- have full access via Prisma.
