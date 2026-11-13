import { authFetch } from '@fitsy/shared/utils/authTransport';
import { supabase } from './supabase';

/**
 * Dev-only: permanently mark the signed-in account as staff/test so it's
 * excluded from launch metrics. Bind the write to the account that actually
 * made the choice.
 */
export async function markInternalOrTestAccount(owner: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session || session.user.is_anonymous || session.user.id !== owner) throw new Error('Account changed');
  // The same public Auth endpoint used by auth.updateUser, with a captured token.
  // A queued SDK updateUser could instead select a newly signed-in account.
  const response = await authFetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/auth/v1/user`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ data: { fitsy_internal_or_test: true } }),
  });
  if (!response.ok) throw new Error('Preference save failed');
  const updated = await response.json() as { id?: unknown };
  if (updated.id !== owner) throw new Error('Unexpected account response');
  const { data: current } = await supabase.auth.getSession();
  if (current.session?.user.id !== owner) throw new Error('Account changed');
  // Refresh the SDK's persisted user and notify the analytics auth listener.
  const { data, error } = await supabase.auth.refreshSession();
  if (error || data.session?.user.id !== owner) throw new Error('Preference refresh failed');
}
