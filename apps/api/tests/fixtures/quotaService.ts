/** Independent reference for the external Redis EVAL boundary, not production Lua. */
export function quotaService() {
  const buckets = new Map<string, number[]>();
  return {
    clear() { buckets.clear(); },
    command(args: string[]): number[] {
      const [, , , index, key, windowRaw, maxRaw, capacityRaw] = args;
      const window = Number(windowRaw), max = Number(maxRaw), capacity = Number(capacityRaw), now = Date.now();
      for (const [id, times] of buckets) {
        if (id.startsWith(index!)) {
          const fresh = times.filter(time => time > now - window);
          if (fresh.length) buckets.set(id, fresh); else buckets.delete(id);
        }
      }
      const id = index! + key!;
      const times = buckets.get(id) ?? [];
      if (times.length >= max) return [0, 0, times[0]! + window - now];
      if (!times.length && [...buckets.keys()].filter(id => id.startsWith(index!)).length >= capacity) return [0, 0, window];
      buckets.set(id, [...times, now]);
      return [1, max - times.length - 1, 0];
    },
  };
}
