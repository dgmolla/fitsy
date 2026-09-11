import type { MenuItemResult } from '@fitsy/shared';
import { chipMatches, deriveTags } from './menuFilters';

const dish = (name: string, description?: string): MenuItemResult => ({ id: 'dietary-fixture', name, description, macros: null });
test.each(['Chicken Bowl', 'Garden Salad', 'Grilled Fish', 'Tofu Bowl', 'Tempeh Salad', 'Seitan', 'Plant-based Bowl'])(
  '%s does not establish a dietary claim', name => {
    const item = dish(name), tags = deriveTags(item);
    expect(tags.glutenFree).toBe(false); expect(tags.vegan).toBe(false);
    expect(chipMatches('gluten_free', item, tags, null)).toBe(false);
    expect(chipMatches('vegan', item, tags, null)).toBe(false);
  },
);
test('explicit claims still supply badges and their corresponding filters', () => {
  const item = dish('Vegan Tofu Bowl', 'Gluten-free rice and vegetables'), tags = deriveTags(item);
  expect(tags.vegan).toBe(true); expect(tags.glutenFree).toBe(true);
  expect(chipMatches('vegan', item, tags, null)).toBe(true);
  expect(chipMatches('gluten_free', item, tags, null)).toBe(true);
});
test.each(['Not vegan; not gluten-free', 'Non-vegan, non gluten free'])(
  'negative statements are not positive claims: %s', description => {
    expect(deriveTags(dish('Tofu Bowl', description))).toEqual({ vegan: false, glutenFree: false, spicy: false });
  },
);
