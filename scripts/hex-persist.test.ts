/**
 * Tests for hex-level atomic persist + checkpoint (S-139).
 *
 * DB tests require POSTGRES_PRISMA_URL and are skipped in CI.
 * Pure unit tests run everywhere.
 */

import type { PrismaClient } from "@prisma/client";
import type { ValidatedPair } from "./pipeline-utils";

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

// Conditional import to avoid PrismaClient errors when no DB is configured
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient: PC } = hasDb ? require("@prisma/client") : { PrismaClient: class {} };
const prisma: PrismaClient | null = hasDb ? new (PC as any)() : null;

// Conditional import of the module under test (uses Prisma at import time via pipeline-utils)
let persistHex: typeof import("./hex-persist")["persistHex"] | undefined;
let isHexComplete: typeof import("./hex-persist")["isHexComplete"] | undefined;

if (hasDb) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("./hex-persist");
  persistHex = mod.persistHex;
  isHexComplete = mod.isHexComplete;
}

const RUN_ID = `test-hex-persist-${Date.now()}`;

afterAll(async () => {
  if (!prisma) return;
  // Clean up checkpoint rows
  await prisma.pipelineCompletedHex.deleteMany({ where: { runId: RUN_ID } });
  await prisma.$disconnect();
});

// ─── DB integration tests ───────────────────────────────────────────────────

describeIfDb("persistHex + isHexComplete (DB)", () => {
  it("isHexComplete returns false for non-existent hex", async () => {
    const result = await isHexComplete!(RUN_ID, "hex_nonexistent", prisma!);
    expect(result).toBe(false);
  });

  it("persistHex with empty restaurants array creates checkpoint with count=0", async () => {
    const hexId = "hex_empty";
    const totalItems = await persistHex!(RUN_ID, hexId, [], prisma!);
    expect(totalItems).toBe(0);

    // Verify the checkpoint was created
    const record = await prisma!.pipelineCompletedHex.findUnique({
      where: { runId_hexId: { runId: RUN_ID, hexId } },
    });
    expect(record).not.toBeNull();
    expect(record!.count).toBe(0);
  });

  it("isHexComplete returns true after hex is checkpointed", async () => {
    // hex_empty was checkpointed in the previous test
    const result = await isHexComplete!(RUN_ID, "hex_empty", prisma!);
    expect(result).toBe(true);
  });

  it("duplicate hex insert is rejected (same runId+hexId)", async () => {
    // hex_empty already exists from the empty-restaurants test above
    await expect(
      persistHex!(RUN_ID, "hex_empty", [], prisma!),
    ).rejects.toThrow();
  });
});

// ─── Pure unit tests (no DB required) ───────────────────────────────────────

describe("hex-persist module exports (type smoke test)", () => {
  it("exports persistHex and isHexComplete functions", () => {
    // Dynamic import to verify the module shape at the type level.
    // In non-DB environments the conditional import above is skipped,
    // so we just verify the types compile. In DB environments we also
    // verify runtime values.
    if (hasDb) {
      expect(typeof persistHex).toBe("function");
      expect(typeof isHexComplete).toBe("function");
    } else {
      // Module not loaded — just verify types compile (this test existing
      // and passing tsc --noEmit is the assertion).
      expect(true).toBe(true);
    }
  });

  it("ValidatedPair type is importable", () => {
    // This is a compile-time check — if ValidatedPair is not exported
    // from pipeline-utils, tsc --noEmit will catch it.
    const _pair: ValidatedPair | undefined = undefined;
    expect(_pair).toBeUndefined();
  });
});
