import Anthropic from "@anthropic-ai/sdk";
import { COST_CONFIG } from "../cost-config";
import type { MacroEstimateResult, ModelAdapter } from "./types";

interface RawEstimate {
  cal: number;
  p: number;
  c: number;
  f: number;
  conf: "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
}

function parseEstimateJson(raw: string): RawEstimate {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/, "")
    .replace(/\n?```\s*$/, "");
  return JSON.parse(stripped) as RawEstimate;
}

function mapToResult(
  result: RawEstimate,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  costUsd: number,
): MacroEstimateResult {
  return {
    calories: Math.round(result.cal),
    proteinG: result.p,
    carbsG: result.c,
    fatG: result.f,
    confidence: result.conf,
    reasoning: result.reasoning,
    inputTokens,
    outputTokens,
    latencyMs,
    costUsd,
  };
}

function createAnthropicAdapter(modelName: string): ModelAdapter {
  const anthropic = new Anthropic({
    apiKey: process.env["ANTHROPIC_API_KEY"],
  });

  return {
    name: modelName,
    async estimate(system: string, userMessage: string): Promise<MacroEstimateResult> {
      const start = Date.now();

      const message = await anthropic.messages.create({
        model: modelName,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: userMessage }],
      });

      const latencyMs = Date.now() - start;

      const contentBlock = message.content[0];
      if (!contentBlock || contentBlock.type !== "text") {
        throw new Error("No text content in response");
      }

      const result = parseEstimateJson(contentBlock.text);

      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;

      const pricing = COST_CONFIG.models[modelName] ?? COST_CONFIG.models["local"]!;
      const costUsd =
        inputTokens * pricing!.input + outputTokens * pricing!.output;

      return mapToResult(result, inputTokens, outputTokens, latencyMs, costUsd);
    },
  };
}

function createOllamaAdapter(modelName: string): ModelAdapter {
  return {
    name: modelName,
    async estimate(system: string, userMessage: string): Promise<MacroEstimateResult> {
      const start = Date.now();

      const response = await fetch("http://localhost:11434/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userMessage },
          ],
          max_tokens: 8192,
        }),
      });

      const latencyMs = Date.now() - start;

      if (!response.ok) {
        throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        choices: { message: { content: string } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const raw = data.choices[0]?.message?.content;
      if (!raw) {
        throw new Error("No content in Ollama response");
      }

      const result = parseEstimateJson(raw);

      const inputTokens = data.usage?.prompt_tokens ?? 0;
      const outputTokens = data.usage?.completion_tokens ?? 0;

      return mapToResult(result, inputTokens, outputTokens, latencyMs, 0);
    },
  };
}

export function createAdapter(modelSpec: string): ModelAdapter {
  if (modelSpec.startsWith("local:")) {
    return createOllamaAdapter(modelSpec.slice("local:".length));
  }
  return createAnthropicAdapter(modelSpec);
}
