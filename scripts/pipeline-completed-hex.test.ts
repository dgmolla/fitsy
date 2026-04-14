/**
 * Tests for PipelineCompletedHex DB model.
 *
 * Spec invariant: "Checkpoint lives in the DB (not a file) for atomicity
 * with data persistence."
 *
 * These tests verify the schema — unique constraint on (runId, hexId),
 * insert, query by runId. The atomicity invariant (checkpoint + data in
 * same transaction) is tested in S-139.
 *
 * Requires a live database with the migration applied. Skipped in CI.
 */

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

// Conditional import to avoid PrismaClient errors when no DB is configured
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient } = hasDb ? require("@prisma/client") : { PrismaClient: class {} };
const prisma = hasDb ? new (PrismaClient as any)() : null;

const RUN_ID = `test-run-${Date.now()}`;

afterAll(async () => {
  // Clean up test data
  await prisma.pipelineCompletedHex.deleteMany({ where: { runId: RUN_ID } });
  await prisma.pipelineCompletedHex.deleteMany({
    where: { runId: `${RUN_ID}-other` },
  });
  await prisma.$disconnect();
});

describeIfDb("PipelineCompletedHex", () => {
  it("inserts a completed hex record", async () => {
    const record = await prisma.pipelineCompletedHex.create({
      data: { runId: RUN_ID, hexId: "hex_001", count: 42 },
    });
    expect(record.runId).toBe(RUN_ID);
    expect(record.hexId).toBe("hex_001");
    expect(record.count).toBe(42);
    expect(record.createdAt).toBeInstanceOf(Date);
  });

  it("rejects duplicate (runId, hexId) — unique constraint", async () => {
    await prisma.pipelineCompletedHex.create({
      data: { runId: RUN_ID, hexId: "hex_dup", count: 10 },
    });
    await expect(
      prisma.pipelineCompletedHex.create({
        data: { runId: RUN_ID, hexId: "hex_dup", count: 20 },
      }),
    ).rejects.toThrow();
  });

  it("allows same hexId with different runId", async () => {
    const otherRun = `${RUN_ID}-other`;
    const record = await prisma.pipelineCompletedHex.create({
      data: { runId: otherRun, hexId: "hex_001", count: 5 },
    });
    expect(record.runId).toBe(otherRun);
    expect(record.hexId).toBe("hex_001");
  });

  it("queries completed hexes by runId", async () => {
    const hexes = await prisma.pipelineCompletedHex.findMany({
      where: { runId: RUN_ID },
      select: { hexId: true },
    });
    const hexIds = hexes.map((h: { hexId: string }) => h.hexId);
    expect(hexIds).toContain("hex_001");
    expect(hexIds).toContain("hex_dup");
  });

  it("checks if a specific hex is complete for a run", async () => {
    const found = await prisma.pipelineCompletedHex.findUnique({
      where: { runId_hexId: { runId: RUN_ID, hexId: "hex_001" } },
    });
    expect(found).not.toBeNull();
    expect(found!.count).toBe(42);

    const notFound = await prisma.pipelineCompletedHex.findUnique({
      where: { runId_hexId: { runId: RUN_ID, hexId: "hex_999" } },
    });
    expect(notFound).toBeNull();
  });
});
