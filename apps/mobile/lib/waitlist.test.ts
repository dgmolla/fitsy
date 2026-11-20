import { joinSavedAreaWaitlist } from './waitlist';
import { api } from './api';
import { getOnboardingData } from './onboardingStorage';

jest.mock('./api', () => ({ api: { post: jest.fn() } }));
jest.mock('./onboardingStorage', () => ({ getOnboardingData: jest.fn() }));

const post = api.post as jest.Mock;
const read = getOnboardingData as jest.Mock;

beforeEach(() => { post.mockReset(); read.mockReset(); });

it('sign-up claims the saved area into the waitlist for the signed-in account (#1012)', async () => {
  read.mockResolvedValue({ area: { lat: 33.4, lng: -112.1, name: 'Phoenix', source: 'manual' } });
  post.mockResolvedValue({});
  await expect(joinSavedAreaWaitlist()).resolves.toBe(true);
  expect(post).toHaveBeenCalledWith('/api/waitlist', { lat: 33.4, lng: -112.1 }, true);
});

it('joins nothing without a saved area, and a failed request reports not joined without throwing (#1012)', async () => {
  read.mockResolvedValue({ area: null });
  await expect(joinSavedAreaWaitlist()).resolves.toBe(false);
  expect(post).not.toHaveBeenCalled();
  read.mockResolvedValue({ area: { lat: 1, lng: 2, name: 'x', source: 'gps' } });
  post.mockRejectedValue(new Error('down'));
  await expect(joinSavedAreaWaitlist()).resolves.toBe(false);
});
