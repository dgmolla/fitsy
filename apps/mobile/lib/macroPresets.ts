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
    label: 'Cut (2000 kcal)',
    values: { calories: '2000', protein: '150', carbs: '200', fat: '67' },
  },
  {
    label: 'Bulk (3000 kcal)',
    values: { calories: '3000', protein: '180', carbs: '350', fat: '100' },
  },
  {
    label: 'Maintain (2500 kcal)',
    values: { calories: '2500', protein: '160', carbs: '280', fat: '83' },
  },
];
