import { z } from 'zod';

/** Minutes in restaurant-local time; Sunday=0. A closing minute before opening crosses midnight. */
export const restaurantHoursSchema = z.object({
  timeZone: z.string().refine(value => {
    try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; }
    catch { return false; }
  }),
  periods: z.array(z.object({
    day: z.number().int().min(0).max(6),
    opens: z.number().int().min(0).max(1439),
    closes: z.number().int().min(0).max(1440),
  }).refine(period => period.opens !== period.closes)).max(100),
});

/** Unknown legacy hours are explicit; malformed hours fail closed. Never use the server's timezone. */
export function restaurantAvailability(hours: unknown, now: Date): 'open' | 'closed' | 'unknown' {
  if (hours === null || hours === undefined) return 'unknown';
  const parsed = restaurantHoursSchema.safeParse(hours);
  if (!parsed.success) return 'closed';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: parsed.data.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (key: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === key)!.value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(part('weekday'));
  const minute = Number(part('hour')) * 60 + Number(part('minute'));
  const open = parsed.data.periods.some(period => period.closes > period.opens
    ? day === period.day && minute >= period.opens && minute < period.closes
    : (day === period.day && minute >= period.opens) || (day === (period.day + 1) % 7 && minute < period.closes));
  return open ? 'open' : 'closed';
}
