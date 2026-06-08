import type { CustomerInfo } from 'react-native-purchases';
import { PAYWALL_RESULT } from 'react-native-purchases-ui';
import {
  ENTITLEMENT_ID,
  isProActive,
  mapPaywallResult,
  pickApiKey,
} from './purchases';

// Build a CustomerInfo-shaped object with the given active entitlement ids.
// Only the `entitlements.active` map is read by isProActive; the rest of the
// real CustomerInfo surface is irrelevant here, hence the cast.
function infoWithEntitlements(...active: string[]): CustomerInfo {
  const map: Record<string, unknown> = {};
  for (const id of active) map[id] = { identifier: id, isActive: true };
  return { entitlements: { active: map, all: map } } as unknown as CustomerInfo;
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

describe('mapPaywallResult', () => {
  it('maps each SDK result to a normalized outcome', () => {
    expect(mapPaywallResult(PAYWALL_RESULT.PURCHASED)).toBe('purchased');
    expect(mapPaywallResult(PAYWALL_RESULT.RESTORED)).toBe('restored');
    expect(mapPaywallResult(PAYWALL_RESULT.CANCELLED)).toBe('cancelled');
    expect(mapPaywallResult(PAYWALL_RESULT.NOT_PRESENTED)).toBe('not_presented');
    expect(mapPaywallResult(PAYWALL_RESULT.ERROR)).toBe('error');
  });
});
