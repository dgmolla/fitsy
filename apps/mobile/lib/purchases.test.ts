import type { CustomerInfo } from 'react-native-purchases';
import { PAYWALL_RESULT } from 'react-native-purchases-ui';
import {
  ENTITLEMENT_ID,
  hasLapsedEntitlement,
  interpretPurchaseError,
  isProActive,
  mapPaywallResult,
  pickApiKey,
  resolveApiKey,
} from './purchases';

// Build a CustomerInfo-shaped object with the given active entitlement ids.
// Only the `entitlements.active` map is read by isProActive; the rest of the
// real CustomerInfo surface is irrelevant here, hence the cast.
function infoWithEntitlements(...active: string[]): CustomerInfo {
  const map: Record<string, unknown> = {};
  for (const id of active) map[id] = { identifier: id, isActive: true };
  return { entitlements: { active: map, all: map } } as unknown as CustomerInfo;
}

// Build a CustomerInfo-shaped object where `active` and `all` differ, so a
// past-but-lapsed entitlement (present in `all`, absent from `active`) can be
// distinguished from one that was never granted at all (absent from both).
function infoWithHistory(activeIds: string[], allIds: string[]): CustomerInfo {
  const active: Record<string, unknown> = {};
  for (const id of activeIds) active[id] = { identifier: id, isActive: true };
  const all: Record<string, unknown> = {};
  for (const id of allIds) all[id] = { identifier: id, isActive: activeIds.includes(id) };
  return { entitlements: { active, all } } as unknown as CustomerInfo;
}

describe('pickApiKey', () => {
  const keys = { ios: 'appl_xxx', android: 'goog_yyy' };

  it('returns the iOS key on iOS', () => {
    expect(pickApiKey('ios', keys)).toBe('appl_xxx');
  });

  it('returns the Android key on Android', () => {
    expect(pickApiKey('android', keys)).toBe('goog_yyy');
  });

  it('returns undefined on unsupported platforms (e.g. web)', () => {
    expect(pickApiKey('web', keys)).toBeUndefined();
  });

  it('returns undefined when the platform key is missing', () => {
    expect(pickApiKey('ios', { android: 'goog_yyy' })).toBeUndefined();
  });
});

describe('resolveApiKey', () => {
  const keys = { ios: 'appl_ios', android: 'goog_and', test: 'test_store' };

  it('uses the Test Store key in dev when present', () => {
    expect(resolveApiKey('ios', true, keys)).toBe('test_store');
    expect(resolveApiKey('android', true, keys)).toBe('test_store');
  });

  it('uses the real per-platform store key outside dev', () => {
    expect(resolveApiKey('ios', false, keys)).toBe('appl_ios');
    expect(resolveApiKey('android', false, keys)).toBe('goog_and');
  });

  it('falls back to the platform key in dev when no test key is set', () => {
    expect(resolveApiKey('ios', true, { ios: 'appl_ios' })).toBe('appl_ios');
  });

  it('returns undefined when nothing is configured for the platform', () => {
    expect(resolveApiKey('ios', false, { android: 'goog_and' })).toBeUndefined();
  });
});

describe('isProActive', () => {
  it('is false for null/undefined customer info', () => {
    expect(isProActive(null)).toBe(false);
    expect(isProActive(undefined)).toBe(false);
  });

  it('is false when the pro entitlement is not active', () => {
    expect(isProActive(infoWithEntitlements())).toBe(false);
    expect(isProActive(infoWithEntitlements('some_other'))).toBe(false);
  });

  it('is true when the pro entitlement is active', () => {
    expect(isProActive(infoWithEntitlements(ENTITLEMENT_ID))).toBe(true);
  });

  it('honours a custom entitlement id', () => {
    expect(isProActive(infoWithEntitlements('vip'), 'vip')).toBe(true);
    expect(isProActive(infoWithEntitlements('vip'))).toBe(false);
  });
});

describe('hasLapsedEntitlement', () => {
  it('is false for null/undefined customer info', () => {
    expect(hasLapsedEntitlement(null)).toBe(false);
    expect(hasLapsedEntitlement(undefined)).toBe(false);
  });

  it('is false when the user never had the entitlement', () => {
    expect(hasLapsedEntitlement(infoWithHistory([], []))).toBe(false);
  });

  it('is false when the entitlement is currently active', () => {
    expect(hasLapsedEntitlement(infoWithHistory([ENTITLEMENT_ID], [ENTITLEMENT_ID]))).toBe(false);
  });

  it('is true when the entitlement is in history but not active — the lapsed case', () => {
    expect(hasLapsedEntitlement(infoWithHistory([], [ENTITLEMENT_ID]))).toBe(true);
  });

  it('honours a custom entitlement id', () => {
    expect(hasLapsedEntitlement(infoWithHistory([], ['vip']), 'vip')).toBe(true);
    expect(hasLapsedEntitlement(infoWithHistory([], ['vip']))).toBe(false);
  });
});

describe('interpretPurchaseError', () => {
  it('treats userCancelled as a cancel, not an error', () => {
    expect(interpretPurchaseError({ userCancelled: true })).toBe('cancelled');
  });

  it('treats everything else as an error', () => {
    expect(interpretPurchaseError({ userCancelled: false })).toBe('error');
    expect(interpretPurchaseError({ code: '23', message: 'config' })).toBe('error');
    expect(interpretPurchaseError(new Error('network'))).toBe('error');
    expect(interpretPurchaseError(null)).toBe('error');
    expect(interpretPurchaseError(undefined)).toBe('error');
  });
});

describe('mapPaywallResult', () => {
  it('maps each SDK result to a normalized outcome', () => {
    expect(mapPaywallResult(PAYWALL_RESULT.PURCHASED)).toBe('purchased');
    expect(mapPaywallResult(PAYWALL_RESULT.RESTORED)).toBe('restored');
    expect(mapPaywallResult(PAYWALL_RESULT.CANCELLED)).toBe('cancelled');
    expect(mapPaywallResult(PAYWALL_RESULT.NOT_PRESENTED)).toBe('not_presented');
    expect(mapPaywallResult(PAYWALL_RESULT.ERROR)).toBe('error');
  });
});
