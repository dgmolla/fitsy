import { z } from 'zod';
import { macroNames, type Macros } from './score';

export const BINNING = {
  calories: { prefix: 'kcal', width: 25, upperEdge: 2500 },
  grams: { prefix: 'g', width: 2, upperEdge: 200 },
  estimator: 'sum(probability * bin representative) / sum(probability)',
  boundedRepresentative: 'midpoint of [lower, upper)',
  openTopRepresentative: 'lower edge + one bin width',
  argmax: 'highest-probability bin; provider choice breaks ties',
  probabilitySumTolerance: 0.01,
} as const;

interface Bin { name: string; criterion: string; representative: number }
function makeBins({ prefix, width, upperEdge }: { prefix: string; width: number; upperEdge: number }): Bin[] {
  return [
    ...Array.from({ length: upperEdge / width }, (_, index) => {
      const lower = index * width, upper = lower + width;
      return { name: `${prefix}_${lower}_${upper}`, criterion: `[${lower},${upper})`, representative: lower + width / 2 };
    }),
    { name: `${prefix}_${upperEdge}_plus`, criterion: `${upperEdge}+`, representative: upperEdge + width },
  ];
}
const calorieBins = makeBins(BINNING.calories), gramBins = makeBins(BINNING.grams);
export const macroBins = { calories: calorieBins, protein: gramBins, carbs: gramBins, fat: gramBins };

function question(bins: Bin[], quantity: string) {
  return {
    type: 'choice' as const,
    instructions: `Estimate total ${quantity} for the specified serving; choose the range containing the total. Ranges include the lower edge and exclude the upper edge.`,
    criteria: Object.fromEntries(bins.map(bin => [bin.name, bin.criterion])),
  };
}
export const macroQuestions = {
  calories: question(calorieBins, 'kilocalories'),
  protein: question(gramBins, 'grams of protein'),
  carbs: question(gramBins, 'grams of total carbohydrate'),
  fat: question(gramBins, 'grams of total fat'),
};

const probability = z.number().finite().min(0).max(1);
function answerSchema(bins: Bin[]) {
  return z.object({
    type: z.literal('choice'), choice: z.enum(bins.map(bin => bin.name) as [string, ...string[]]), confidence: probability,
    probabilities: z.object(Object.fromEntries(bins.map(bin => [bin.name, probability]))).strict(),
  }).refine(answer => {
    const probabilities = Object.values(answer.probabilities), total = probabilities.reduce((sum, value) => sum + value, 0);
    return Math.abs(total - 1) <= BINNING.probabilitySumTolerance + bins.length * Number.EPSILON
      && answer.probabilities[answer.choice]! >= Math.max(...probabilities);
  }, 'Invalid choice probabilities');
}
export const macroAnswersSchema = z.object({
  calories: answerSchema(calorieBins), protein: answerSchema(gramBins),
  carbs: answerSchema(gramBins), fat: answerSchema(gramBins),
}).strict();

/** Decode validated distributions only; retain the winning bin separately from the mean. */
export function decodeMacroAnswers(answers: z.infer<typeof macroAnswersSchema>) {
  const estimate = Object.fromEntries(macroNames.map(macro => {
    const probabilities = answers[macro].probabilities;
    const total = Object.values(probabilities).reduce((sum, value) => sum + value, 0);
    return [macro, macroBins[macro].reduce((sum, bin) => sum + probabilities[bin.name]! * bin.representative, 0) / total];
  })) as Macros;
  const argmaxBins = Object.fromEntries(macroNames.map(macro => [macro, answers[macro].choice])) as Record<keyof Macros, string>;
  return { estimate, argmaxBins };
}
