import { parsePaywallVariantConfig, paywallVariantConfig, resolvePaywallVariant } from './paywallVariant';

test('invalid or missing allocation safely uses the chosen B layout', () => {
  for (const raw of [undefined, '', '{', '{"mode":"segmented","version":"v1","percentB":101}', '{"mode":"B-only"}']) {
    expect(resolvePaywallVariant(parsePaywallVariantConfig(raw), 'user-1')).toBe('B');
  }
});

test('explicit modes and stable account segmentation use authenticated IDs', () => {
  const a = parsePaywallVariantConfig('{"mode":"A-only","version":"v1"}');
  const b = parsePaywallVariantConfig('{"mode":"B-only","version":"v1"}');
  expect(resolvePaywallVariant(a, 'user-1')).toBe('A');
  expect(resolvePaywallVariant(b, 'user-1')).toBe('B');
  const split = parsePaywallVariantConfig('{"mode":"segmented","version":"v1","percentB":37}');
  const first = resolvePaywallVariant(split, 'auth-user-1');
  expect(resolvePaywallVariant(split, 'auth-user-1')).toBe(first);
  expect(resolvePaywallVariant(split, null)).toBe('A');
  expect(resolvePaywallVariant({ ...split, percentB: 0 }, 'auth-user-1')).toBe('A');
  expect(resolvePaywallVariant({ ...split, percentB: 100 }, 'auth-user-1')).toBe('B');
});

test('RevenueCat metadata is the single remote configuration input', () => {
  expect(paywallVariantConfig({ paywall_layout_config: { mode: 'B-only', version: 'review-1' } })).toEqual({ mode: 'B-only', version: 'review-1' });
  expect(paywallVariantConfig({ paywall_layout_config: { mode: 'segmented', version: 'bad' } }).mode).toBe('B-only');
});
