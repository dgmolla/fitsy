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
import type { StructuredMenuItem, MacroData } from "./menuSources/types";

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

    const [first, second] = result;
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

  it("sets source field to 'haiku' on all returned items", async () => {
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(HAIKU_ESTIMATES)));

    const result = await estimateMacros(ITEMS, client);

    for (const item of result) {
      expect(item.source).toBe("haiku");
    }
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
      "Unexpected Haiku response type",
    );
  });

  // ── Filtering of items with missing required fields ───────────────────────

  it("filters out items missing required numeric fields", async () => {
    const partialEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "HIGH" },
      { cal: null, p: 8, c: 30, f: 24, conf: "MEDIUM" }, // missing cal
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(partialEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(1);
    expect(result[0]?.calories).toBe(320);
  });

  it("filters out items with invalid confidence value", async () => {
    const badEstimates = [
      { cal: 320, p: 42, c: 2, f: 14, conf: "VERY_HIGH" }, // invalid conf
      { cal: 380, p: 8, c: 30, f: 24, conf: "LOW" },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(badEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(1);
    expect(result[0]?.confidence).toBe("LOW");
  });

  it("filters out null/non-object entries", async () => {
    const mixedEstimates = [
      null,
      { cal: 380, p: 8, c: 30, f: 24, conf: "LOW" },
    ];
    mockCreate.mockResolvedValue(makeTextResponse(JSON.stringify(mixedEstimates)));

    const result = await estimateMacros(ITEMS, client);

    expect(result).toHaveLength(1);
    expect(result[0]?.calories).toBe(380);
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
