import { z } from 'zod';

export const WEBHOOK_BODY_MAX_BYTES = 256 * 1024;
const identifier = z.string().min(1).max(1024);
const identities = z.array(identifier).max(100);
// Null/omission still means lifetime expiry or the legacy event-time fallback.
// Present values must be positive integral milliseconds representable by Date.
const epochMs = z.number().int().positive().max(8.64e15).nullish();

// Parse only the envelope before dispatch: future events may have new shapes.
export const webhookEnvelopeSchema = z.object({
  event: z.object({ type: z.string().min(1).max(128) }).passthrough(),
});

// Unknown provider fields (including subscriber_attributes) are discarded.
// They are neither persisted nor copied into diagnostics.
export const revenueCatEventSchema = z.object({
  type: z.string().min(1).max(128),
  environment: z.enum(['PRODUCTION', 'SANDBOX']).optional(),
  entitlement_ids: z.array(identifier).max(100).nullish(),
  app_user_id: identifier.optional(),
  aliases: identities.optional(),
  product_id: identifier.optional(),
  expiration_at_ms: epochMs,
  transaction_id: identifier.nullish(),
  original_transaction_id: identifier.nullish(),
  event_timestamp_ms: epochMs,
  transferred_from: identities.optional(),
  transferred_to: identities.optional(),
});

export const lifecycleEventSchema = revenueCatEventSchema.extend({
  entitlement_ids: z.array(identifier).max(100),
});
export const transferEventSchema = revenueCatEventSchema.extend({
  transferred_from: identities,
  transferred_to: identities,
});

export type RevenueCatEvent = z.output<typeof revenueCatEventSchema>;
