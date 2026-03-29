import { SUGGESTION_FILTERS, applySuggestionFilter } from './macroSuggestions';

describe('SUGGESTION_FILTERS', () => {
  it('exports exactly three filters', () => {
    expect(SUGGESTION_FILTERS).toHaveLength(3);
  });

  it('has protein-dense, low-carb, and low-fat ids', () => {
    const ids = SUGGESTION_FILTERS.map((f) => f.id);
    expect(ids).toContain('protein-dense');
    expect(ids).toContain('low-carb');
    expect(ids).toContain('low-fat');
  });

  it('each filter has label, icon, and hint', () => {
    for (const filter of SUGGESTION_FILTERS) {
      expect(filter.label).toBeTruthy();
      expect(filter.icon).toBeTruthy();
      expect(filter.hint).toBeTruthy();
    }
  });
});

describe('applySuggestionFilter', () => {
  describe('protein-dense', () => {
    it('sets protein to ~10% of calories in grams (40% kcal from protein)', () => {
      const result = applySuggestionFilter('protein-dense', '2000');
      expect(parseInt(result.protein)).toBe(200); // 2000 * 0.1
    });

    it('protein + carbs*4 + fat*9 is within 5% of target calories', () => {
      const cal = 2000;
      const result = applySuggestionFilter('protein-dense', String(cal));
      const kcal = parseInt(result.protein) * 4 + parseInt(result.carbs) * 4 + parseInt(result.fat) * 9;
      expect(kcal).toBeGreaterThan(cal * 0.95);
      expect(kcal).toBeLessThan(cal * 1.05);
    });

    it('defaults to 2000 kcal when calories input is empty', () => {
      const empty = applySuggestionFilter('protein-dense', '');
      const explicit = applySuggestionFilter('protein-dense', '2000');
      expect(empty).toEqual(explicit);
    });

    it('defaults to 2000 kcal when calories input is invalid', () => {
      const invalid = applySuggestionFilter('protein-dense', 'abc');
      const explicit = applySuggestionFilter('protein-dense', '2000');
      expect(invalid).toEqual(explicit);
    });

    it('scales with different calorie inputs', () => {
      const result3000 = applySuggestionFilter('protein-dense', '3000');
      expect(parseInt(result3000.protein)).toBe(300); // 3000 * 0.1
    });
  });

  describe('low-carb', () => {
    it('carb kcal is ~10% of total calories', () => {
      const cal = 2000;
      const result = applySuggestionFilter('low-carb', String(cal));
      const carbKcal = parseInt(result.carbs) * 4;
      expect(carbKcal / cal).toBeCloseTo(0.1, 1);
    });

    it('protein + carbs*4 + fat*9 is within 5% of target calories', () => {
      const cal = 2000;
      const result = applySuggestionFilter('low-carb', String(cal));
      const kcal = parseInt(result.protein) * 4 + parseInt(result.carbs) * 4 + parseInt(result.fat) * 9;
      expect(kcal).toBeGreaterThan(cal * 0.95);
      expect(kcal).toBeLessThan(cal * 1.05);
    });

    it('carbs are lower than protein', () => {
      const result = applySuggestionFilter('low-carb', '2000');
      expect(parseInt(result.carbs)).toBeLessThan(parseInt(result.protein));
    });
  });

  describe('low-fat', () => {
    it('fat kcal is ~15% of total calories', () => {
      const cal = 2000;
      const result = applySuggestionFilter('low-fat', String(cal));
      const fatKcal = parseInt(result.fat) * 9;
      expect(fatKcal / cal).toBeCloseTo(0.15, 1);
    });

    it('protein + carbs*4 + fat*9 is within 5% of target calories', () => {
      const cal = 2000;
      const result = applySuggestionFilter('low-fat', String(cal));
      const kcal = parseInt(result.protein) * 4 + parseInt(result.carbs) * 4 + parseInt(result.fat) * 9;
      expect(kcal).toBeGreaterThan(cal * 0.95);
      expect(kcal).toBeLessThan(cal * 1.05);
    });

    it('fat is lower than carbs', () => {
      const result = applySuggestionFilter('low-fat', '2000');
      expect(parseInt(result.fat)).toBeLessThan(parseInt(result.carbs));
    });
  });

  it('returns string values for all fields', () => {
    for (const filter of SUGGESTION_FILTERS) {
      const result = applySuggestionFilter(filter.id, '2000');
      expect(typeof result.protein).toBe('string');
      expect(typeof result.carbs).toBe('string');
      expect(typeof result.fat).toBe('string');
    }
  });
});
