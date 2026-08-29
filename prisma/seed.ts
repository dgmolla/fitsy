/**
 * Deterministic seed fixture.
 *
 * Produces the same rows every run (idempotent upserts) so tests and E2E flows
 * can rely on exact names, coordinates, and macros:
 *
 *   - 3 users in Supabase auth + our User table (see SEED_USERS)
 *   - 1 brand ("Seed Bowl Co") with 8 chain items
 *   - 50 restaurants in a ~1.5 mile ring around downtown LA (SEED_CENTER)
 *   - 8 menu items per restaurant with denormalized macros + a MacroEstimate
 *
 * Targets whatever POSTGRES_URL_NON_POOLING points at, except production,
 * which is refused by scripts/dev/lib/guard.ts. Users need SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY for the same project as the database.
 *
 * Usage:
 *   npx prisma db seed                 # everything
 *   npx tsx prisma/seed.ts --users-only
 *   npx tsx prisma/seed.ts --data-only
 */

import { PrismaClient, ConfidenceLevel } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { assertNotProd, hostOf } from "../scripts/dev/lib/guard";

export const SEED_CENTER = { lat: 34.0522, lng: -118.2437 }; // downtown LA
export const SEED_PASSWORD = "fitsy-seed-pass-2026";

export const SEED_USERS = [
  // Pro via DEMO_REVIEW_EMAILS in the dev Vercel env; used for entitled flows.
  { email: "seed-pro@fitsy.dev", name: "Seed Pro", pro: true },
  // Free: exercises the 402 subscription gate.
  { email: "seed-free@fitsy.dev", name: "Seed Free", pro: false },
  // Fresh: onboardingStep 0, no macro target; exercises onboarding.
  { email: "seed-new@fitsy.dev", name: "Seed New", pro: false },
] as const;

const CUISINES = ["mexican", "japanese", "american", "mediterranean", "thai", "korean", "italian", "vegan"];
const ITEM_TEMPLATES = [
  { name: "Grilled Chicken Bowl", cal: 520, p: 42, c: 48, f: 14, conf: ConfidenceLevel.HIGH },
  { name: "Steak Salad", cal: 610, p: 38, c: 22, f: 38, conf: ConfidenceLevel.MEDIUM },
  { name: "Salmon Plate", cal: 580, p: 40, c: 35, f: 28, conf: ConfidenceLevel.HIGH },
  { name: "Veggie Wrap", cal: 430, p: 14, c: 58, f: 16, conf: ConfidenceLevel.MEDIUM },
  { name: "Turkey Burger", cal: 640, p: 36, c: 50, f: 30, conf: ConfidenceLevel.LOW },
  { name: "Tofu Stir Fry", cal: 470, p: 22, c: 55, f: 17, conf: ConfidenceLevel.MEDIUM },
  { name: "Egg White Omelette", cal: 310, p: 30, c: 8, f: 16, conf: ConfidenceLevel.HIGH },
  { name: "Protein Smoothie", cal: 280, p: 28, c: 34, f: 5, conf: ConfidenceLevel.LOW },
];

/** Mulberry32: tiny seeded PRNG so coordinates are stable across runs. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function supabaseAdmin() {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to seed users");
  if (url.includes("zaxkmjqozvmbifiwbxps") && process.env["FITSY_ALLOW_PROD"] !== "1") {
    throw new Error("SUPABASE_URL points at production auth. Refusing.");
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function seedUsers(prisma: PrismaClient): Promise<void> {
  const admin = supabaseAdmin();
  // listUsers is paginated; the seed set is tiny so one page is enough.
  const { data: existing, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  const byEmail = new Map(existing.users.map((u) => [u.email?.toLowerCase(), u.id]));

  for (const u of SEED_USERS) {
    let id = byEmail.get(u.email);
    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email: u.email,
        password: SEED_PASSWORD,
        email_confirm: true,
        user_metadata: { name: u.name, seed: true },
      });
      if (error) throw error;
      id = data.user.id;
    }
    const isNew = u.email === "seed-new@fitsy.dev";
    await prisma.user.upsert({
      where: { id },
      create: {
        id,
        email: u.email,
        name: u.name,
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
      update: { email: u.email, name: u.name },
    });
    console.error(`  user ${u.email} (${id})${u.pro ? " [pro via DEMO_REVIEW_EMAILS]" : ""}`);
  }
}

export async function seedData(prisma: PrismaClient): Promise<void> {
  const brand = await prisma.brand.upsert({
    where: { slug: "seed-bowl-co" },
    create: { slug: "seed-bowl-co", displayName: "Seed Bowl Co", locationCount: 5, macroSource: "official", detectionConf: "high" },
    update: { displayName: "Seed Bowl Co" },
  });
  for (const t of ITEM_TEMPLATES) {
    const key = t.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await prisma.chainItem.upsert({
      where: { brandId_canonicalKey: { brandId: brand.id, canonicalKey: key } },
      create: { brandId: brand.id, canonicalKey: key, calories: t.cal, proteinG: t.p, carbsG: t.c, fatG: t.f, source: "official", confidence: "HIGH", retrievedAt: new Date("2026-01-01") },
      update: { calories: t.cal, proteinG: t.p, carbsG: t.c, fatG: t.f },
    });
  }

  const rand = rng(20260828);
  for (let i = 0; i < 50; i++) {
    const angle = rand() * Math.PI * 2;
    const radiusMi = 0.2 + rand() * 1.3;
    const lat = SEED_CENTER.lat + (radiusMi / 69) * Math.sin(angle);
    const lng = SEED_CENTER.lng + (radiusMi / (69 * Math.cos((SEED_CENTER.lat * Math.PI) / 180))) * Math.cos(angle);
    const isChain = i < 5;
    const cuisine = CUISINES[i % CUISINES.length]!;
    const n = String(i + 1).padStart(2, "0");
    const restaurant = await prisma.restaurant.upsert({
      where: { storeUuid: `seed-rest-${n}` },
      create: {
        storeUuid: `seed-rest-${n}`,
        name: isChain ? `Seed Bowl Co #${n}` : `Seed ${cuisine[0]!.toUpperCase()}${cuisine.slice(1)} Kitchen ${n}`,
        address: `${100 + i} Seed St, Los Angeles, CA 90012`,
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        cuisineTags: [cuisine],
        chainFlag: isChain,
        brand: isChain ? "Seed Bowl Co" : null,
        brandId: isChain ? brand.id : null,
        source: "seed",
        rating: Number((3.5 + rand() * 1.5).toFixed(1)),
        userRatingCount: Math.floor(50 + rand() * 900),
        priceLevel: ["$", "$$", "$$$"][i % 3]!,
        lastScrapedAt: new Date("2026-01-01"),
      },
      update: { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), cuisineTags: [cuisine] },
    });
    for (const t of ITEM_TEMPLATES) {
      const jitter = isChain ? 0 : Math.round((rand() - 0.5) * 60);
      const cal = t.cal + jitter;
      const item = await prisma.menuItem.upsert({
        where: { restaurantId_name: { restaurantId: restaurant.id, name: t.name } },
        create: { restaurantId: restaurant.id, name: t.name, category: "Mains", price: Number((9 + rand() * 12).toFixed(2)), calories: cal, proteinG: t.p, carbsG: t.c, fatG: t.f },
        update: { calories: cal, proteinG: t.p, carbsG: t.c, fatG: t.f },
      });
      await prisma.macroEstimate.upsert({
        where: { menuItemId_source: { menuItemId: item.id, source: "seed" } },
        create: { menuItemId: item.id, calories: cal, proteinG: t.p, carbsG: t.c, fatG: t.f, confidence: t.conf, source: "seed", reasoning: "deterministic seed fixture" },
        update: { calories: cal, confidence: t.conf },
      });
    }
  }
  console.error("  50 restaurants, 400 menu items, 400 macro estimates, 1 brand, 8 chain items");
}

async function main(): Promise<void> {
  const url = assertNotProd(process.env["POSTGRES_URL_NON_POOLING"], "POSTGRES_URL_NON_POOLING");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const args = new Set(process.argv.slice(2));
  console.error(`seed -> ${hostOf(url)}`);
  try {
    if (!args.has("--data-only")) await seedUsers(prisma);
    if (!args.has("--users-only")) await seedData(prisma);
  } finally {
    await prisma.$disconnect();
  }
  console.log(JSON.stringify({ name: "seed", status: "pass", target: hostOf(url) }));
}

// Only run when executed directly (reset.ts imports the functions).
if (process.argv[1] && /seed\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
