import { EvalCase } from "./lib/types";

export const EVAL_CASES: EvalCase[] = [
  { name: "haiku-baseline",      model: "claude-haiku-4-5",   prompt: "baseline" },
  { name: "haiku-serving",       model: "claude-haiku-4-5",   prompt: "serving-size" },
  { name: "haiku-chain-hints",   model: "claude-haiku-4-5",   prompt: "chain-hints" },
  // Gemma cases — uncomment when Ollama is available (needs ~3.5GB free RAM)
  // { name: "gemma-baseline",    model: "local:gemma2:9b",  prompt: "baseline" },
  // { name: "gemma-serving",     model: "local:gemma2:9b",  prompt: "serving-size" },
  // { name: "gemma-chain-hints", model: "local:gemma2:9b",  prompt: "chain-hints" },
];

export function allPermutations(
  models: string[],
  prompts: string[],
): EvalCase[] {
  return models.flatMap(model =>
    prompts.map(prompt => ({
      name: `${model.split("-").pop() ?? model}-${prompt}`,
      model,
      prompt,
    }))
  );
}
