/**
 * Real-database tests for server-side entitlement (danger zone: the paywall
 * cannot be client-trusted). No mocks: rows go into the container and
 * isEntitled reads them back.
 */
import { randomUUID } from "node:crypto";

// jose is ESM-only and unused by the entitlement path; lib/subscription pulls
// it in transitively via lib/auth -> services/authService. External module, so
// mocking it here stays inside the own-code-mocks boundary.
jest.mock("jose", () => ({}));

jest.setTimeout(30_000); // remote dev DBs are slower than the CI container

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb("isEntitled (DB)", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { prisma } = require("@/lib/restaurantService") as typeof import("../../lib/restaurantService");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isEntitled } = require("@/lib/subscription") as typeof import("../../lib/subscription");

  const RUN = `dbtest-${Date.now()}`;
  const madeUserIds: string[] = [];

  async function makeUser(suffix: string): Promise<{ id: string; email: string }> {
    const id = randomUUID();
    const email = `${RUN}-${suffix}@fitsy.dev`;
    await prisma.user.create({ data: { id, email, name: suffix } });
    madeUserIds.push(id);
    return { id, email };
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: madeUserIds } } });
    await prisma.$disconnect();
  });

  it("no subscription row -> not entitled", async () => {
    const u = await makeUser("none");
    expect(await isEntitled(u.id, u.email)).toBe(false);
  });

  it("active subscription -> entitled", async () => {
    const u = await makeUser("active");
    await prisma.subscription.create({
      data: { userId: u.id, plan: "monthly", status: "active", expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(await isEntitled(u.id, u.email)).toBe(true);
  });

  it("expired subscription -> not entitled", async () => {
    const u = await makeUser("expired");
    await prisma.subscription.create({
      data: { userId: u.id, plan: "monthly", status: "active", expiresAt: new Date(Date.now() - 86_400_000) },
    });
    expect(await isEntitled(u.id, u.email)).toBe(false);
  });

  it("non-active status -> not entitled", async () => {
    const u = await makeUser("canceled");
    await prisma.subscription.create({
      data: { userId: u.id, plan: "monthly", status: "canceled", expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(await isEntitled(u.id, u.email)).toBe(false);
  });

  it("DEMO_REVIEW_EMAILS bypass entitles without a row", async () => {
    const u = await makeUser("demo");
    const saved = process.env["DEMO_REVIEW_EMAILS"];
    process.env["DEMO_REVIEW_EMAILS"] = u.email;
    try {
      expect(await isEntitled(u.id, u.email)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env["DEMO_REVIEW_EMAILS"];
      else process.env["DEMO_REVIEW_EMAILS"] = saved;
    }
  });
});
