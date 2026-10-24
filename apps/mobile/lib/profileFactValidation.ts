import { calculateAge } from '../../../packages/shared/src/utils/dateUtils';

export function validateProfileFact(field: string, value: unknown): void {
  if (field === 'weightKg' || field === 'heightCm') {
    const [min, max] = field === 'weightKg' ? [23, 320] : [122, 229];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      throw new Error(field === 'weightKg' ? 'Enter a weight between 51 and 705 lbs.' : 'Enter a height between 122 and 229 cm.');
    }
  }
  if (field === 'birthday') {
    const age = typeof value === 'string' ? calculateAge(value) : NaN;
    if (!Number.isFinite(age) || age < 13 || age > 99) throw new Error('Enter an age between 13 and 99.');
  }
}
