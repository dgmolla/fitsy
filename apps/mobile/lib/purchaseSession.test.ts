import { router } from 'expo-router';
import { supabase } from './supabase';
import { ensureSessionForPurchase } from './purchaseSession';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: { auth: { getSession: jest.fn() } } }));

beforeEach(() => {
  jest.clearAllMocks();
});

it('replaces a payment screen after session loss so Back cannot expose a pre-auth paywall', async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });
  expect(await ensureSessionForPurchase()).toBe(false);
  expect(router.replace).toHaveBeenCalledWith('/welcome/signin?returnTo=payment');
  expect(router.push).not.toHaveBeenCalled();
});

it('allows an authenticated checkout without changing navigation', async () => {
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'buyer' } } } });
  expect(await ensureSessionForPurchase('resubscribe')).toBe(true);
  expect(router.replace).not.toHaveBeenCalled();
});
