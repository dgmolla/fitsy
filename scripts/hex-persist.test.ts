/**
 * Tests for hex-level atomic persist + checkpoint (S-139).
 *
 * Mock tests run everywhere. DB tests require POSTGRES_PRISMA_URL (skipped in CI).
 */

jest.mock("./constants", () => ({
  aggregateDietaryOptions: jest.fn().mockReturnValue([]),
}));

// Mock pipeline-utils DB functions for unit tests.
// DB integration tests only use empty restaurant arrays, so these mocks don't affect them.
const mockPersistItemsInTx = jest.fn();
const mockComputeDietaryInTx = jest.fn();
const mockUpdateMenuHashInTx = jest.fn();

jest.mock("./pipeline-utils", () => ({
  ...jest.requireActual("./pipeline-utils"),
  persistItemsInTx: (...args: unknown[]) => mockPersistItemsInTx(...args),
  computeAndStoreDietaryOptionsInTx: (...args: unknown[]) =>
    mockComputeDietaryInTx(...args),
  updateMenuHashInTx: (...args: unknown[]) =>
    mockUpdateMenuHashInTx(...args),
}));

import { persistHex, isHexComplete, type HexRestaurantData } from "./hex-persist";
import type { ValidatedPair } from "./pipeline-utils";

const hasDb = !!process.env["POSTGRES_PRISMA_URL"];
const describeIfDb = hasDb ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PrismaClient: PC } = hasDb
  ? require("@prisma/client")
  : { PrismaClient: class {} };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma: any = hasDb ? new (PC as any)() : null;

const RUN_ID = `test-hex-persist-${Date.now()}`;

afterAll(async () => {
  if (!prisma) return;
  await prisma.pipelineCompletedHex.deleteMany({ where: { runId: RUN_ID } });
  await prisma.$disconnect();
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeValidatedPair(name: string): ValidatedPair {
  return {
    item: { name },
    macro: {
      calories: 500,
      proteinG: 30,
      carbsG: 50,
      fatG: 20,
      confidence: "MEDIUM",
      source: "haiku",
      dietaryTags: [],
    },
  };
}

function makeMockPrisma() {
  const mockCreate = jest.fn().mockResolvedValue({});
  const mockTx = { pipelineCompletedHex: { create: mockCreate } };
  const mockPrismaObj = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction: jest.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
  };
  return { mockPrisma: mockPrismaObj, mockTx, mockCreate };
}

// ─── Mock unit tests (no DB needed) ─────────────────────────────────────────

describe("persistHex transaction semantics (mock)", () => {
  beforeEach(() => {
    mockPersistItemsInTx.mockReset().mockResolvedValue(5);
    mockComputeDietaryInTx.mockReset().mockResolvedValue(undefined);
    mockUpdateMenuHashInTx.mockReset().mockResolvedValue(undefined);
  });

  it("calls $transaction exactly once", async () => {
    const { mockPrisma } = makeMockPrisma();
    const restaurants: HexRestaurantData[] = [
      { restaurantId: "r1", items: [makeValidatedPair("Burger")], menuHash: "abc" },
    ];

    await persistHex("run-1", "hex-1", restaurants, mockPrisma as any);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("calls persist + dietary + menuHash for each restaurant", async () => {
    const { mockPrisma, mockTx } = makeMockPrisma();
    const restaurants: HexRestaurantData[] = [
      { restaurantId: "r1", items: [makeValidatedPair("Burger")], menuHash: "abc" },
      { restaurantId: "r2", items: [makeValidatedPair("Pizza")], menuHash: "def" },
    ];

    await persistHex("run-1", "hex-1", restaurants, mockPrisma as any);

    expect(mockPersistItemsInTx).toHaveBeenCalledTimes(2);
    expect(mockComputeDietaryInTx).toHaveBeenCalledTimes(2);
    expect(mockUpdateMenuHashInTx).toHaveBeenCalledTimes(2);

    expect(mockPersistItemsInTx).toHaveBeenCalledWith("r1", restaurants[0]!.items, mockTx);
    expect(mockPersistItemsInTx).toHaveBeenCalledWith("r2", restaurants[1]!.items, mockTx);
    expect(mockUpdateMenuHashInTx).toHaveBeenCalledWith("r1", "abc", mockTx);
    expect(mockUpdateMenuHashInTx).toHaveBeenCalledWith("r2", "def", mockTx);
  });

  it("creates checkpoint in the same transaction with correct data", async () => {
    const { mockPrisma, mockCreate } = makeMockPrisma();
    const restaurants: HexRestaurantData[] = [
      { restaurantId: "r1", items: [makeValidatedPair("Burger")], menuHash: "abc" },
      { restaurantId: "r2", items: [makeValidatedPair("Pizza")], menuHash: "def" },
    ];

    await persistHex("run-1", "hex-1", restaurants, mockPrisma as any);

    expect(mockCreate).toHaveBeenCalledWith({
      data: { runId: "run-1", hexId: "hex-1", count: 2 },
    });
  });

  it("returns total item count across all restaurants", async () => {
    mockPersistItemsInTx.mockResolvedValueOnce(5).mockResolvedValueOnce(3);
    const { mockPrisma } = makeMockPrisma();
    const restaurants: HexRestaurantData[] = [
      { restaurantId: "r1", items: [makeValidatedPair("Burger")], menuHash: "abc" },
      { restaurantId: "r2", items: [makeValidatedPair("Pizza")], menuHash: "def" },
    ];

    const total = await persistHex("run-1", "hex-1", restaurants, mockPrisma as any);
    expect(total).toBe(8);
  });

  it("rejects when a persist operation fails (no checkpoint written)", async () => {
    mockPersistItemsInTx
      .mockResolvedValueOnce(5)
      .mockRejectedValueOnce(new Error("DB constraint violation"));
    const { mockPrisma, mockCreate } = makeMockPrisma();
    const restaurants: HexRestaurantData[] = [
      { restaurantId: "r1", items: [makeValidatedPair("Burger")], menuHash: "abc" },
      { restaurantId: "r2", items: [makeValidatedPair("Pizza")], menuHash: "def" },
    ];

    await expect(
      persistHex("run-1", "hex-1", restaurants, mockPrisma as any),
    ).rejects.toThrow("DB constraint violation");

    // Checkpoint must NOT be written when a persist fails
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ─── DB integration tests ───────────────────────────────────────────────────

describeIfDb("persistHex + isHexComplete (DB)", () => {
  it("isHexComplete returns false for non-existent hex", async () => {
    const result = await isHexComplete(RUN_ID, "hex_nonexistent", prisma!);
    expect(result).toBe(false);
  });

  it("persistHex with empty restaurants array creates checkpoint with count=0", async () => {
    const hexId = "hex_empty";
    const totalItems = await persistHex(RUN_ID, hexId, [], prisma!);
    expect(totalItems).toBe(0);

    const record = await prisma!.pipelineCompletedHex.findUnique({
      where: { runId_hexId: { runId: RUN_ID, hexId } },
    });
    expect(record).not.toBeNull();
    expect(record!.count).toBe(0);
  });

  it("isHexComplete returns true after hex is checkpointed", async () => {
    const result = await isHexComplete(RUN_ID, "hex_empty", prisma!);
    expect(result).toBe(true);
  });

  it("duplicate hex insert is rejected (same runId+hexId)", async () => {
    await expect(persistHex(RUN_ID, "hex_empty", [], prisma!)).rejects.toThrow();
  });
});
