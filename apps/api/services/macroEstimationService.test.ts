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
  { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH", tags: [] },
  { cal: 380, p: 8, c: 30, f: 24, conf: "MEDIUM", tags: ["vegetarian"] },
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
    // Post-hoc calibration: carbs × 1.08, fat × 1.3, cal recalculated from macros
    // Input: { cal: 320, p: 42, c: 2, f: 14 } → c=2.2, f=18.2, cal=42*4+2.2*4+18.2*9=340
    // Input: { cal: 380, p: 8, c: 30, f: 24 } → c=32.4, f=31.2, cal=8*4+32.4*4+31.2*9=442
    expect(first).toEqual<MacroData>({
      calories: 340,
      proteinG: 42,
      carbsG: 2.2,
      fatG: 18.2,
      confidence: "HIGH",
      source: "haiku",
      dietaryTags: [],
    });
    expect(second).toEqual<MacroData>({
      calories: 442,
      proteinG: 8,
      carbsG: 32.4,
      fatG: 31.2,
      confidence: "MEDIUM",
      source: "haiku",
      dietaryTags: ["vegetarian"],
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
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH", tags: [] },
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
    expect(result[0]?.calories).toBe(340); // calibrated from 320
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

  it("pads with null when Haiku returns fewer items than input", async () => {
    // Haiku ignores prompt instruction and returns only 1 item for 2 inputs
    const tooFewEstimates = [{ cal: 320, p: 42, c: 2, f: 14, conf: "HIGH", tags: [] }];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(tooFewEstimates)));

    const result = await estimateMacros(ITEMS, client);
    expect(result).toHaveLength(2);
    expect(result[0]).not.toBeNull(); // first item estimated
    expect(result[1]).toBeNull();     // second item padded with null
  });

  it("truncates when Haiku returns more items than input", async () => {
    const tooManyEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH", tags: [] },
      { cal: 380, p: 8, c: 30, f: 24, conf: "MEDIUM", tags: [] },
      { cal: 200, p: 5, c: 20, f: 10, conf: "LOW", tags: [] }, // extra item
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(tooManyEstimates)));

    const result = await estimateMacros(ITEMS, client);
    expect(result).toHaveLength(2); // truncated to input length
    expect(result[0]).not.toBeNull();
    expect(result[1]).not.toBeNull();
  });

  // ── Positional contract — null preserves position ─────────────────────────

  it("returns null at position of invalid item, preserving subsequent valid items", async () => {
    const partialEstimates = [
      { cal: "not-a-number", p: 8, c: 30, f: 24, conf: "MEDIUM", tags: [] }, // invalid cal type
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH", tags: [] },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(partialEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeNull(); // invalid item → null, not dropped
    expect(result[1]?.calories).toBe(340); // valid item preserved at index 1 (calibrated from 320)
  });

  it("returns null for items missing required numeric fields", async () => {
    const partialEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH", tags: [] },
      { p: 8, c: 30, f: 24, conf: "MEDIUM", tags: [] }, // missing cal
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(partialEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    // cal: 320 → calibrated: 340 (p:42, c:2*1.08=2.16, f:14*1.3=18.2, cal=42*4+2.16*4+18.2*9)
    expect(result[0]?.calories).toBe(340);
    expect(result[1]).toBeNull();
  });

  it("returns null for items with invalid confidence value", async () => {
    const badEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "VERY_HIGH", tags: [] }, // invalid conf
      { cal: 380, p: 8, c: 30, f: 24, conf: "LOW", tags: [] },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(badEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeNull();
    expect(result[1]?.confidence).toBe("LOW");
  });

  it("returns null for null entries in Haiku array", async () => {
    const mixedEstimates = [null, { cal: 380, p: 8, c: 30, f: 24, conf: "LOW", tags: [] }];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(mixedEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(2);
    expect(result[0]).toBeNull();
    // cal: 380 → calibrated: 442 (p:8, c:30*1.08=32.4, f:24*1.3=31.2, cal=8*4+32.4*4+31.2*9)
    expect(result[1]?.calories).toBe(442);
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

  // ── Dietary tags ──────────────────────────────────────────────────────────

  it("maps known dietary tags to dietaryTags field", async () => {
    const estimates = [
      { cal: 200, p: 5, c: 30, f: 4, conf: "HIGH", tags: ["vegan", "gluten-free"] },
      { cal: 380, p: 8, c: 30, f: 24, conf: "MEDIUM", tags: ["vegetarian"] },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(estimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result[0]?.dietaryTags).toEqual(["vegan", "gluten-free"]);
    expect(result[1]?.dietaryTags).toEqual(["vegetarian"]);
  });

  it("strips unknown tags and preserves known ones", async () => {
    const estimates = [
      { cal: 200, p: 5, c: 30, f: 4, conf: "HIGH", tags: ["vegan", "organic", "local"] },
      { cal: 380, p: 8, c: 30, f: 24, conf: "MEDIUM", tags: [] },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(estimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result[0]?.dietaryTags).toEqual(["vegan"]);
    expect(result[1]?.dietaryTags).toEqual([]);
  });

  it("returns empty dietaryTags when tags field is missing", async () => {
    const estimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH" }, // no tags field
      { cal: 380, p: 8, c: 30, f: 24, conf: "MEDIUM", tags: [] },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(estimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result[0]?.dietaryTags).toEqual([]);
    expect(result[1]?.dietaryTags).toEqual([]);
  });
});
