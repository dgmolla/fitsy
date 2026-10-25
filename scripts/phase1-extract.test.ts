import { validateRow, extractFromText, extractFromImages } from './phase1-extract';
import Anthropic from '@anthropic-ai/sdk';
jest.mock('@anthropic-ai/sdk', () => ({ __esModule: true, default: jest.fn(() => ({ messages: { create: jest.fn() } })) }));
const row = { name: 'Synthetic allulose fixture', servingSize: '1 serving', calories: 12, proteinG: 0, carbsG: 30, fatG: 0 };

test('allulose uses 0.4 kcal/g without substituting net carbohydrate or widening tolerance', () => {
  expect(validateRow(row).valid).toBe(false);
  expect(validateRow({ ...row, alluloseG: 30 })).toEqual({ valid: true, note: 'ok' });
  for (const alluloseG of [-1, 31, NaN, Infinity]) expect(validateRow({ ...row, alluloseG }).valid).toBe(false);
  for (const patch of [{ calories: NaN }, { calories: Infinity }, { proteinG: NaN }, { carbsG: Infinity }, { fatG: NaN }]) {
    expect(validateRow({ ...row, ...patch, alluloseG: 30 }).valid).toBe(false);
  }
  expect(validateRow({ ...row, calories: 400, proteinG: 20, carbsG: 50, fatG: 13 }).valid).toBe(true);
});

test('text and image extraction retain explicitly published allulose for downstream source review', async () => {
  // Only the external paid API is replaced. Both real extraction adapters and their validator execute.
  const create = jest.fn().mockResolvedValue({ usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'tool_use',
    content: [{ type: 'tool_use', input: { items: [{ name: row.name, serving_size: '1 serving', calories: 12,
      protein_g: 0, carbs_g: 30, fat_g: 0, allulose_g: 30 }] } }] });
  (Anthropic as unknown as jest.Mock).mockImplementation(() => ({ messages: { create } }));
  for (const result of [await extractFromText('Fixture', 'Retained label text'), await extractFromImages('Fixture', [Buffer.from('fixture')])]) {
    expect(result).toEqual([{ ...row, alluloseG: 30 }]);
    expect(validateRow(result[0]!).valid).toBe(true);
  }
  expect(create.mock.calls[0]![0].messages[0].content).toContain('never infer');
});
