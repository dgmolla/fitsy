import type { MutableRefObject } from 'react';
import type { CustomerInfo } from 'react-native-purchases';
import type { EntitlementSyncReason } from './entitlement';

export interface EntitlementVerdict {
  /** The server's verdict; null until settled on this launch. Gates screens. */
  entitled: boolean | null;
  /** Same value, readable from async callbacks. */
  entitledRef: MutableRefObject<boolean | null>;
  /** True inside STORE_GRACE_MS after the store confirmed a purchase/restore. */
  inStoreGrace: () => boolean;
  /**
   * Ask the server and store the answer. Resolves to the verdict NOW IN
   * EFFECT: the stored answer, or `true` when a server "false" was refused
   * inside the store grace window. Null when the server couldn't be asked
   * (`entitled` unchanged); `false` without a session, with no request made.
   */
  syncEntitlement: (reason: EntitlementSyncReason) => Promise<boolean | null>;
  /**
   * Boot: bounded cache, server, and RevenueCat identity reads run in
   * parallel, then one fold: server, else cache, else the device.
   * Rejects if `rcReady` rejects (see settleAfterBootFailure).
   */
  resolveAtBoot: (
    userId: string | undefined,
    rcReady: Promise<CustomerInfo | null>,
    isCancelled: () => boolean,
  ) => Promise<void>;
  /** Boot threw: still settle (cache, else device, else false) so no gate holds forever. */
  settleAfterBootFailure: (userId: string | undefined, isCancelled: () => boolean) => Promise<void>;
  /**
   * Sign-in: hold the gates (null), identify, give the server the cap, else
   * fall back to the device; the late answer still applies.
   */
  resolveAfterSignIn: (userId: string, identify: () => Promise<CustomerInfo | null>) => Promise<void>;
  /** The store just confirmed Pro: entitled now, cached, grace window open. */
  markStoreConfirmed: () => void;
  /** Sign-out, synchronous half: hold the gates (null), drop cache and grace window. */
  beginSignOut: () => void;
  /** Sign-out, after the RevenueCat logout: not entitled unless a sign-in arrived meanwhile. Lock-free. */
  settleAfterSignOut: () => void;
}
