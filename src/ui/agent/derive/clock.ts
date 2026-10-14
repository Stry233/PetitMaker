/* Elapsed-time readings shared by the desk card, the tickets and the folded hero chip. */
import type { PanelView } from '../../../agent/panel';
import { PHASE } from './phase';
import type { I18nKey } from '../../../i18n/keys';

/** `M:SS` from a second count, or null where there is nothing to show. */
export function fmtClock(secs: number | null): string | null {
  if (secs === null || secs < 0) return null;
  const whole = Math.floor(secs);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** What the hero chip says, or null where there is nothing for it to say. */
interface HeroChipFace { wordKey: I18nKey; clock: string }

/** Folded-character status, only while a job is actively progressing. */
export function heroChipFace(view: PanelView, now: number): HeroChipFace | null {
  if (!PHASE[view.phase].running || !view.current) return null;
  const clock = fmtClock((now - view.current.orderAt) / 1000);
  if (clock === null) return null;
  return { wordKey: PHASE[view.phase].word, clock };
}
