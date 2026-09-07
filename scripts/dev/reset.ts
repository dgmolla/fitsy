/**
 * Reset the dev environment's USER data to seed state.
 *
 * Keeps restaurant/menu/macro data (snapshot + seed). Deletes every Supabase
 * auth user in the dev project, truncates the user-owned tables, and re-creates
 * the seed users. Intended to run nightly and before E2E runs.
 *
 * Refuses production via guard.ts.
 */

import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { assertNotProd, hostOf, isProdUrl } from "./lib/guard";
import { seedUsers } from "../../prisma/seed";

const USER_TABLES = ["Feedback", "SavedItem", "Subscription", "MacroTarget", "LaunchWaitlist", "User"];

async function deleteAllAuthUsers(): Promise<number> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (isProdUrl(url) && process.env["FITSY_ALLOW_PROD"] !== "1") throw new Error("SUPABASE_URL points at production auth. Refusing.");
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  let deleted = 0;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw error;
    if (data.users.length === 0) break;
    for (const u of data.users) {
      const { error: delErr } = await admin.auth.admin.deleteUser(u.id);
      if (delErr) throw delErr;
      deleted++;
    }
  }
  return deleted;
}

/**
 * SQL-only mode (no SUPABASE_SERVICE_ROLE_KEY, e.g. scheduled CI): the
 * postgres role manages auth.users directly. Seed auth users are PRESERVED
 * (passwords cannot be recreated without the admin API); their public rows
 * are rebuilt from auth.users.
 */
async function resetSqlOnly(prisma: PrismaClient): Promise<void> {
  const wiped = await prisma.$executeRawUnsafe(
    `DELETE FROM auth.users WHERE email NOT LIKE 'seed-%@fitsy.dev'`,
  );
  await prisma.$executeRawUnsafe(`TRUNCATE ${USER_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
  const seedRows = await prisma.$queryRawUnsafe<{ id: string; email: string }[]>(
    `SELECT id::text AS id, email FROM auth.users WHERE email LIKE 'seed-%@fitsy.dev'`,
  );
  for (const u of seedRows) {
    const isNew = u.email === "seed-new@fitsy.dev";
    await prisma.user.create({
      data: {
        id: u.id,
        email: u.email,
        name: u.email.split("@")[0]!,
        onboardingStep: isNew ? 0 : 15,
        ...(isNew
          ? {}
          : {
              sex: "male",
              heightCm: 178,
              weightKg: 80,
              activityLevel: "moderate",
              goal: "cut",
              macroTarget: { create: { calories: 2100, proteinG: 170, carbsG: 200, fatG: 65, goalType: "cut" } },
            }),
      },
    });
  }
  console.error(`  sql-only: wiped ${wiped} non-seed auth users, rebuilt ${seedRows.length} seed user rows`);
}

async function main(): Promise<void> {
  const url = assertNotProd(process.env["POSTGRES_URL_NON_POOLING"], "POSTGRES_URL_NON_POOLING");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  console.error(`reset -> ${hostOf(url)}`);
  try {
    if (process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
      const authDeleted = await deleteAllAuthUsers();
      await prisma.$executeRawUnsafe(`TRUNCATE ${USER_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
      console.error(`  deleted ${authDeleted} auth users, truncated ${USER_TABLES.join(", ")}`);
      await seedUsers(prisma);
    } else {
      await resetSqlOnly(prisma);
    }
    console.log(JSON.stringify({ name: "reset", status: "pass", target: hostOf(url), mode: process.env["SUPABASE_SERVICE_ROLE_KEY"] ? "admin" : "sql-only" }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
