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

async function main(): Promise<void> {
  const url = assertNotProd(process.env["POSTGRES_URL_NON_POOLING"], "POSTGRES_URL_NON_POOLING");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  console.error(`reset -> ${hostOf(url)}`);
  try {
    const authDeleted = await deleteAllAuthUsers();
    await prisma.$executeRawUnsafe(`TRUNCATE ${USER_TABLES.map((t) => `"${t}"`).join(", ")} CASCADE`);
    console.error(`  deleted ${authDeleted} auth users, truncated ${USER_TABLES.join(", ")}`);
    await seedUsers(prisma);
    console.log(JSON.stringify({ name: "reset", status: "pass", target: hostOf(url), authDeleted }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
