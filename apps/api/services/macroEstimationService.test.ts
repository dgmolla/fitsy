// ─── Mock @anthropic-ai/sdk before importing the service ─────────────────────

const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
  };
});

import Anthropic from "@anthropic-ai/sdk";
import { estimateMacros } from "./macroEstimationService";
import type { MacroData, StructuredMenuItem } from "./menuSources/types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAnthropicClient(): Anthropic {
  return new Anthropic();
}

function makeTextResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

const ITEMS: StructuredMenuItem[] = [
  { name: "Grilled Chicken", description: "Grilled chicken breast with herbs", section: "Entrees" },
  { name: "Caesar Salad", description: "Romaine lettuce, croutons, parmesan", price: 12.99 },
];

const HAIKU_ESTIMATES = [
  { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH" },
  { cal: 380, p: 8, c: 30, f: 24, conf: "MEDIUM" },
];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("estimateMacros", () => {
  let client: Anthropic;

  beforeEach(() => {
    mockCreate.mockReset();
    client = makeAnthropicClient();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("returns MacroData[] in same order as input on happy path", async () => {
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(HAIKU_ESTIMATES)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);

    const first = result[0];
    const second = result[1];
    expect(first).toEqual<MacroData>({
      calories: 320,
      proteinG: 42,
      carbsG: 2,
      fatG: 14,
      confidence: "HIGH",
      source: "haiku",
    });
    expect(second).toEqual<MacroData>({
      calories: 380,
      proteinG: 8,
      carbsG: 30,
      fatG: 24,
      confidence: "MEDIUM",
      source: "haiku",
    });
  });

  it("returns empty array when input is empty", async () => {
    const result = await estimateMacros([], client);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("sets source field to 'haiku' on all valid items in mixed result", async () => {
    // Test with one valid + one null so we verify valid items specifically have source: "haiku"
    const mixedEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH" },
      null, // will become null in output
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(mixedEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result[0]?.source).toBe("haiku");
    expect(result[1]).toBeNull();
  });

  // ── Markdown fence stripping ──────────────────────────────────────────────

  it("strips markdown fences around JSON response", async () => {
    const fenced = "```json\n" + JSON.stringify(HAIKU_ESTIMATES) + "\n```";
    mockCreate.mockResolvedValue(makeTextResponse(fenced));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    expect(result[0]?.calories).toBe(320);
  });

  it("strips plain markdown fences (no language tag)", async () => {
    const fenced = "```\n" + JSON.stringify(HAIKU_ESTIMATES) + "\n```";
    mockCreate.mockResolvedValue(makeTextResponse(fenced));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
  });

  // ── Malformed JSON ────────────────────────────────────────────────────────

  it("throws on malformed JSON response", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("not valid json at all {"));

    await expect(estimateMacros(ITEMS, client)).rejects.toThrow(
      "macroEstimationService: failed to parse Haiku response",
    );
  });

  it("throws when response is valid JSON but not an array", async () => {
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify({ error: "oops" })));

    await expect(estimateMacros(ITEMS, client)).rejects.toThrow(
      "macroEstimationService: Haiku response is not an array",
    );
  });

  it("throws on unexpected response content type", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "tool_use", id: "x", name: "foo", input: {} }],
    });

    await expect(estimateMacros(ITEMS, client)).rejects.toThrow(
      "macroEstimationService: unexpected Haiku response type",
    );
  });

  it("throws when Haiku returns fewer items than input", async () => {
    // Haiku ignores prompt instruction and returns only 1 item for 2 inputs
    const tooFewEstimates = [{ cal: 320, p: 42, c: 2, f: 14, conf: "HIGH" }];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(tooFewEstimates)));

    await expect(estimateMacros(ITEMS, client)).rejects.toThrow(
      "macroEstimationService: Haiku returned 1 items for 2 inputs",
    );
  });

  it("throws when Haiku returns more items than input", async () => {
    const tooManyEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH" },
      { cal: 380, p: 8, c: 30, f: 24, conf: "MEDIUM" },
      { cal: 200, p: 5, c: 20, f: 10, conf: "LOW" }, // extra item
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(tooManyEstimates)));

    await expect(estimateMacros(ITEMS, client)).rejects.toThrow(
      "macroEstimationService: Haiku returned 3 items for 2 inputs",
    );
  });

  // ── Positional contract — null preserves position ─────────────────────────

  it("returns null at position of invalid item, preserving subsequent valid items", async () => {
    const partialEstimates = [
      { cal: "not-a-number", p: 8, c: 30, f: 24, conf: "MEDIUM" }, // invalid cal type
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH" },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(partialEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeNull(); // invalid item → null, not dropped
    expect(result[1]?.calories).toBe(320); // valid item preserved at index 1
  });

  it("returns null for items missing required numeric fields", async () => {
    const partialEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH" },
      { p: 8, c: 30, f: 24, conf: "MEDIUM" }, // missing cal
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(partialEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    expect(result[0]?.calories).toBe(320);
    expect(result[1]).toBeNull();
  });

  it("returns null for items with invalid confidence value", async () => {
    const badEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "VERY_HIGH" }, // invalid conf
      { cal: 380, p: 8, c: 30, f: 24, conf: "LOW" },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(badEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeNull();
    expect(result[1]?.confidence).toBe("LOW");
  });

  it("returns null for null entries in Haiku array", async () => {
    const mixedEstimates = [null, { cal: 380, p: 8, c: 30, f: 24, conf: "LOW" }];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(mixedEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeNull();
    expect(result[1]?.calories).toBe(380);
  });

  // ── Correct model + max_tokens ─────────────────────────────────────────────

  it("passes correct model to Anthropic create", async () => {
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(HAIKU_ESTIMATES)));

    await estimateMacros(ITEMS, client);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-haiku-4-5" }),
    );
  });

  it("passes max_tokens: 8192 to Anthropic create", async () => {
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(HAIKU_ESTIMATES)));

    await estimateMacros(ITEMS, client);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 8192 }),
    );
  });

  it("passes system prompt to Anthropic create", async () => {
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(HAIKU_ESTIMATES)));

    await estimateMacros(ITEMS, client);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("nutrition expert"),
      }),
    );
  });
});
