export interface MacroValues {
  protein: string;
  carbs: string;
  fat: string;
  calories: string;
}

export interface Preset {
  label: string;
  values: MacroValues;
}

export const PRESETS: Preset[] = [
  {
    label: 'Cut (2000 kcal/day)',
    values: { calories: '2000', protein: '110', carbs: '246', fat: '64' },
  },
  {
    label: 'Bulk (3000 kcal/day)',
    values: { calories: '3000', protein: '130', carbs: '395', fat: '100' },
  },
  {
    label: 'Maintain (2500 kcal/day)',
    values: { calories: '2500', protein: '115', carbs: '330', fat: '80' },
  },
];
