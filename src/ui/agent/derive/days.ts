/* The calendar day a record was made, as the past-jobs list groups it and its cards stamp it. */
import type { I18nKey } from '../../../i18n/keys';

export type Day = 'today' | 'yesterday' | 'earlier';

/** The label each day wears, in the list's headers and on an opened record. */
export const DAY_KEY: Record<Day, I18nKey> = {
  today: 'agent.history_day_today',
  yesterday: 'agent.history_day_yesterday',
  earlier: 'agent.history_day_earlier',
};

/** Midnight before `ms` in the reader's own timezone: a day boundary is local. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Which day header a record stands under. */
export function dayOf(at: number, now: number): Day {
  const midnight = startOfDay(now);
  if (at >= midnight) return 'today';
  // Yesterday is 23 or 25 hours long across a clock change: its start is the midnight before it.
  if (at >= startOfDay(midnight - 1)) return 'yesterday';
  return 'earlier';
}
