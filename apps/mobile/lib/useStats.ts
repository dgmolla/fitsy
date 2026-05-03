import { useEffect, useState } from 'react';
import { api } from './api';
import { trackStatsFetchFailed } from './analytics';

export interface Stats {
  totalDishes: number;
  indiePercent: number;
}

// Defaults match the last known prod values from /api/restaurants/stats so a
// failed or in-flight fetch shows a believable number on the data-scale screen
// instead of a dramatically-stale 2,400. Refresh whenever the real numbers
// shift materially (next time you do an eas update or rebuild).
const FALLBACK: Stats = { totalDishes: 676137, indiePercent: 85 };

let cached: Stats | null = null;

export function useStats(): Stats {
  const [stats, setStats] = useState<Stats>(cached ?? FALLBACK);

  useEffect(() => {
    if (cached) return;

    api.get<Stats>('/api/restaurants/stats')
      .then((res) => {
        const resolved: Stats = {
          totalDishes: res.totalDishes || FALLBACK.totalDishes,
          indiePercent: res.indiePercent || FALLBACK.indiePercent,
        };
        cached = resolved;
        setStats(resolved);
      })
      .catch((err: unknown) => {
        // No UI change — FALLBACK numbers are believable enough that we'd
        // rather ship them than block the data-scale screen. But silence is
        // not acceptable: instrument the failure so we can see it in PostHog
        // and the dev console instead of inferring from stale numbers.
        // eslint-disable-next-line no-console
        console.warn('[useStats] /api/restaurants/stats failed:', err);
        trackStatsFetchFailed(err);
      });
  }, []);

  return stats;
}
