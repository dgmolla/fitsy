/**
 * Tests for hex-level resume (S-140).
 *
 * Spec invariant: "Resume is the default, not a flag."
 *
 * DB integration tests require POSTGRES_PRISMA_URL. Skipped in CI.
 */

import { getCompletedHexIds, filterPendingHexes } from "./hex-resume";

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

// Conditional import to avoid PrismaClient errors when no DB is configured
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = hasDb
  ? require("@prisma/client")
  : { PrismaClient: class {} };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma: any = hasDb ? new (PrismaClient as any)() : null;

const RUN_ID = `test-resume-${Date.now()}`;

if (hasDb) {
  afterAll(async () => {
    await prisma.pipelineCompletedHex.deleteMany({
      where: { runId: RUN_ID },
    });
    await prisma.$disconnect();
  });
}

// ---------------------------------------------------------------------------
// DB integration tests
// ---------------------------------------------------------------------------

describeIfDb("getCompletedHexIds", () => {
  it("returns empty set for fresh run", async () => {
    const completed = await getCompletedHexIds(RUN_ID, prisma);
    expect(completed.size).toBe(0);
  });

  it("returns completed hex IDs after checkpointing", async () => {
    // Seed some completed hexes
    await prisma.pipelineCompletedHex.createMany({
      data: [
        { runId: RUN_ID, hexId: "hex_aaa", count: 10 },
        { runId: RUN_ID, hexId: "hex_bbb", count: 5 },
        { runId: RUN_ID, hexId: "hex_ccc", count: 8 },
      ],
    });

    const completed = await getCompletedHexIds(RUN_ID, prisma);
    expect(completed.size).toBe(3);
    expect(completed.has("hex_aaa")).toBe(true);
    expect(completed.has("hex_bbb")).toBe(true);
    expect(completed.has("hex_ccc")).toBe(true);
  });

  it("does not include hexes from other runs", async () => {
    const completed = await getCompletedHexIds("nonexistent-run", prisma);
    expect(completed.size).toBe(0);
  });
});

describeIfDb("filterPendingHexes", () => {
  it("filters out completed hexes", async () => {
    // hex_aaa, hex_bbb, hex_ccc were created above
    const allHexes = ["hex_aaa", "hex_bbb", "hex_ccc", "hex_ddd", "hex_eee"];
    const pending = await filterPendingHexes(allHexes, RUN_ID, prisma);

    expect(pending).toEqual(["hex_ddd", "hex_eee"]);
  });

  it("returns all hexes for fresh run", async () => {
    const allHexes = ["hex_111", "hex_222", "hex_333"];
    const pending = await filterPendingHexes(
      allHexes,
      "fresh-run-never-used",
      prisma,
    );

    expect(pending).toEqual(allHexes);
  });

  it("returns empty array when all hexes are complete", async () => {
    const allHexes = ["hex_aaa", "hex_bbb", "hex_ccc"];
    const pending = await filterPendingHexes(allHexes, RUN_ID, prisma);

    expect(pending).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pure unit tests (no DB needed)
// ---------------------------------------------------------------------------

describe("hex-resume module exports", () => {
  it("exports getCompletedHexIds function", () => {
    expect(typeof getCompletedHexIds).toBe("function");
  });

  it("exports filterPendingHexes function", () => {
    expect(typeof filterPendingHexes).toBe("function");
  });
});
