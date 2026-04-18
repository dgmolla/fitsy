import { useEffect, useState } from 'react';
import { api } from './api';

export interface Stats {
  totalDishes: number;
  indiePercent: number;
}

const FALLBACK: Stats = { totalDishes: 2400, indiePercent: 82 };

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
      .catch(() => {});
  }, []);

  return stats;
}
