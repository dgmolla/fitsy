/**
 * Resolve `promise`, or `null` once `ms` have passed, whichever is first.
 * The underlying promise keeps running; callers that care about a late
 * answer attach to it themselves. The timer is cleared when the race
 * settles so nothing dangles.
 *
 * Candidates for the same helper (left alone for now, each has its own
 * inline race): lib/useLocation.ts and app/welcome/location-permission.tsx.
 */
export function withinMs<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
