import type { Translate } from './keys';

/** What a screen reader hears about a button that presses itself after `seconds`: while the clock
 *  runs, and once focus has stopped it. */
export function timedHint(t: Translate, seconds: number): { running: string; stopped: string } {
  return { running: t('timed.self_press', { seconds }), stopped: t('timed.stopped') };
}
