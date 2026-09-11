import Purchases from 'react-native-purchases';
import { configurePurchases, fetchIntroEligibility } from './purchases';

const developmentFlag = Object.getOwnPropertyDescriptor(globalThis, '__DEV__');
beforeAll(() => {
  Object.defineProperty(globalThis, '__DEV__', { value: false, configurable: true });
  expect(configurePurchases()).toBe(true);
});
afterAll(() => {
  if (developmentFlag) Object.defineProperty(globalThis, '__DEV__', developmentFlag);
  else Reflect.deleteProperty(globalThis, '__DEV__');
});
afterEach(() => jest.restoreAllMocks());

test('only affirmative SDK eligibility allows introductory copy for that product', async () => {
  const sdk = jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockResolvedValue({
    annual: { status: 2, description: 'Eligible' },
    monthly: { status: 1, description: 'Ineligible' },
    discount: { status: 3, description: 'No introductory offer' },
    unresolved: { status: 0, description: 'Unknown' },
  });
  const ids = ['annual', 'monthly', 'discount', 'unresolved', 'missing'];
  await expect(fetchIntroEligibility(ids)).resolves.toEqual({ annual: true, monthly: false, discount: false });
  expect(sdk).toHaveBeenCalledWith(ids);
});

test('SDK failure leaves eligibility unknown instead of promising a free trial', async () => {
  jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility').mockRejectedValue(new Error('Store unavailable'));
  await expect(fetchIntroEligibility(['annual'])).resolves.toEqual({});
});

test('no products means no eligibility request', async () => {
  const sdk = jest.spyOn(Purchases, 'checkTrialOrIntroductoryPriceEligibility');
  await expect(fetchIntroEligibility([])).resolves.toEqual({});
  expect(sdk).not.toHaveBeenCalled();
});
