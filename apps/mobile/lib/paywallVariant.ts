export type PaywallVariant = 'A' | 'B';
export type PaywallVariantConfig = { mode: 'A-only' | 'B-only' | 'segmented'; version: string; percentB?: number };

// The chosen B layout is the release default. Segmentation requires explicit configuration.
const DEFAULT: PaywallVariantConfig = { mode: 'B-only', version: 'default-b' };

export function parsePaywallVariantConfig(raw: string | undefined): PaywallVariantConfig {
  if (!raw) return DEFAULT;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return DEFAULT;
    const item = value as Record<string, unknown>;
    if ((item.mode !== 'A-only' && item.mode !== 'B-only' && item.mode !== 'segmented') ||
      typeof item.version !== 'string' || !/^[a-zA-Z0-9._-]{1,40}$/.test(item.version)) return DEFAULT;
    if (item.mode === 'segmented' && (typeof item.percentB !== 'number' ||
      !Number.isInteger(item.percentB) || item.percentB < 0 || item.percentB > 100)) return DEFAULT;
    return { mode: item.mode, version: item.version, ...(item.mode === 'segmented' ? { percentB: item.percentB as number } : {}) };
  } catch { return DEFAULT; }
}

/** FNV-1a over the authenticated account ID and version, stable across devices. */
export function resolvePaywallVariant(config: PaywallVariantConfig, userId: string | null, testerOverride?: PaywallVariant): PaywallVariant {
  if (typeof __DEV__ !== 'undefined' && __DEV__ && testerOverride) return testerOverride;
  if (config.mode === 'B-only') return 'B';
  if (config.mode !== 'segmented' || !userId) return 'A';
  let hash = 2166136261;
  for (const char of `${config.version}:${userId}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 10000) < (config.percentB ?? 0) * 100 ? 'B' : 'A';
}

/** Existing RevenueCat offering metadata is the single remote configuration surface. */
export function paywallVariantConfig(metadata?: Record<string, unknown> | null): PaywallVariantConfig {
  const value = metadata?.paywall_layout_config;
  return parsePaywallVariantConfig(typeof value === 'string' ? value : value && typeof value === 'object' ? JSON.stringify(value) : undefined);
}
