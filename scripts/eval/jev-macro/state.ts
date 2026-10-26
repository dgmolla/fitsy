import { nutritionQuantity, type TruthRow } from './truth';

/** The sole item-dependent projection for v2 and exploratory v3. */
export function macroState(item: TruthRow) {
  if (nutritionQuantity.test([item.itemName, item.section, item.description, item.serving].join('\n'))) {
    throw new Error('Item text contains nutrition targets; exclude it before evaluation');
  }
  return { chain: item.chain, itemName: item.itemName,
    description: [item.section ? `Section: ${item.section}` : '', item.description].filter(Boolean).join('\n'), serving: item.serving };
}
