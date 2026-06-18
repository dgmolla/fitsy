import { isReviewEmail } from './reviewAccess';

describe('isReviewEmail', () => {
  it('matches the review demo account (case-insensitive, trimmed)', () => {
    expect(isReviewEmail('appreview@fitsy.org')).toBe(true);
    expect(isReviewEmail('  APPREVIEW@Fitsy.org ')).toBe(true);
  });

  it('rejects normal users and empty values', () => {
    expect(isReviewEmail('user@example.com')).toBe(false);
    expect(isReviewEmail('appreview@fitsy.com')).toBe(false); // wrong TLD
    expect(isReviewEmail('')).toBe(false);
    expect(isReviewEmail(null)).toBe(false);
    expect(isReviewEmail(undefined)).toBe(false);
  });
});
