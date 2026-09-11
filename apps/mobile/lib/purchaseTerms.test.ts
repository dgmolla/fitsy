import { periodLabel, purchaseTerms, savingPercent } from './purchaseTerms';

const annual = {
  priceString: '€54,99', subscriptionPeriod: 'P1Y',
  introPrice: { price: 0, priceString: '€0,00', period: 'P1W', periodUnit: 'WEEK', periodNumberOfUnits: 1, cycles: 1 },
};

test('eligible trial terms use the live duration and localized price', () => {
  expect(purchaseTerms(annual, true)).toMatchObject({ trial: '7 days', price: '€54,99', recurring: '€54,99 every 1 year' });
  expect(purchaseTerms(annual, true)?.disclosure).toContain('No charge until the trial ends');
  expect(purchaseTerms(annual, true)?.disclosure).not.toContain('when you confirm');
});
test('ineligible store result discloses payment on confirmation without a trial', () => {
  const terms = purchaseTerms(annual, false);
  expect(terms?.trial).toBeNull();
  expect(terms?.disclosure).toContain('€54,99 charged when you confirm');
  expect(terms?.disclosure).not.toMatch(/free|trial/);
});
test('unknown eligibility promises neither a trial nor an immediate charge', () => {
  const terms = purchaseTerms(annual);
  expect(terms?.trial).toBeNull();
  expect(terms?.disclosure).toContain('confirm any eligible introductory offer and the first charge before purchase');
  expect(terms?.disclosure).not.toMatch(/free|charged when|No charge/);
});
test('a changed store offer changes the trial without an app update', () => {
  expect(purchaseTerms({ ...annual, introPrice: { ...annual.introPrice, period: 'P2W' } }, true)?.trial).toBe('14 days');
  expect(purchaseTerms({ ...annual, introPrice: null }, true)?.trial).toBeNull();
});
test.each([null, { ...annual, priceString: '' }, { ...annual, subscriptionPeriod: null }])('missing store terms have no invented fallback: %j', product => {
  expect(purchaseTerms(product, true)).toBeNull();
});
test('paid introductory pricing is disclosed without calling it free', () => {
  const terms = purchaseTerms({ ...annual, introPrice: { ...annual.introPrice, price: 2.99, priceString: '€2,99', period: 'P1M', cycles: 3 } }, true);
  expect(terms?.trial).toBeNull();
  expect(terms?.disclosure).toContain('€2,99 every 1 month for 3 months, then €54,99 every 1 year');
});
test('period parsing preserves calendar months and rejects unsupported or invalid periods', () => {
  expect(periodLabel('P1M', 1, true)).toBe('1 month');
  expect(periodLabel('P1W', 2, true)).toBe('14 days');
  for (const value of ['P0D', 'P-1D', 'not-a-period', 'P1Y2M']) expect(periodLabel(value)).toBeNull();
  expect(periodLabel('P1D', 0)).toBeNull();
});
test('discount copy compares live prices, currency and billing duration', () => {
  const regular = { price: 60, currencyCode: 'EUR', subscriptionPeriod: 'P1Y' };
  expect(savingPercent(regular, { ...regular, price: 45 })).toBe(25);
  expect(savingPercent(regular, { ...regular, price: 30 })).toBe(50);
  expect(savingPercent(regular, { ...regular, price: 45, currencyCode: 'USD' })).toBeNull();
  expect(savingPercent(regular, { ...regular, price: 45, subscriptionPeriod: 'P1M' })).toBeNull();
  expect(savingPercent(regular, { ...regular, price: 60 })).toBeNull();
  expect(savingPercent(null, regular)).toBeNull();
});
