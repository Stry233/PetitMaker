/*
 * ResumeCard.tsx — a held job offered back (normative prototype `.card.resume`).
 *
 * IT IS NOT THE PAUSED TICKET, and the difference is what the panel is SAYING. A ticket standing in
 * the paused state is a run the user is inside: its ops are on screen, its tape is held, and Resume
 * is one of two answers at its foot. This card is the OFFER — a job the session came back holding,
 * or one it cannot continue — so it carries the order, where the work stopped, what is already on
 * the map, and nothing else. There is no op list because nothing is happening; the record of what
 * ran is the job's own, and reading it is a different press.
 *
 * A BLOCKED OFFER DRAWS NO RESUME. Where the hold cannot be lifted from here — the key went away, so
 * the next request has nothing to send — the reason line plus the repair ARE the card. A Resume that
 * would refuse the press is worse than no Resume: it promises a continuation the panel cannot make,
 * and the user presses it once for every time they read the sentence beside it.
 *
 * AND NEITHER FACE OFFERS A PAUSE. The loop honours a pause only at a call boundary, and a job that
 * is already held has no boundary coming — so a pause offered here is a door that never opens, over
 * a job whose other door (Resume) the blocked face has already closed.
 *
 * THE PAPER IS ONE STEP DOWN THE RAMP: the wait paper mixed into the plate, which is what makes the
 * chips inside it step back UP to the plate rather than down to the inset every other card's do.
 */
import type { CSSProperties } from 'react';
import { RESUME_PRIMARY } from './atoms';
import { Icon } from './icons';
import { CARD_PAD, edge, statePaper } from './tokens';
import { INK, PLATE } from '../design/tokens';
import { colors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowPill } from '../design/window-skin';
import { useT } from '../../i18n/context';

/** The card's own paper: the wait tone laid over the plate rather than at full strength, since the
 *  card is a rest state's news and not a warning. The prototype mixes it at exactly this share. */
const RESUME_PAPER = `color-mix(in srgb, ${statePaper.wait} 42%, ${PLATE})`;

const CARD_STYLE: CSSProperties = {
  background: RESUME_PAPER,
  // `edge` IS THE WHOLE SHORTHAND (`tokens.ts` re-exports the shell's `PANEL_EDGE`, width and style
  // included), so a width written in front of it emits `1px solid 1px solid …` — one declaration the
  // engine drops entire, leaving the card with no outline at all on a plate it is a shade away from.
  border: edge,
  borderRadius: 24,
  padding: CARD_PAD,
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  flex: '0 0 auto',
  boxShadow: 'none',
};

const ORDER_STYLE: CSSProperties = {
  ...roleFont('label'), fontFamily: font.family, fontWeight: 800, color: INK, lineHeight: 1.35,
};

const NOTE_STYLE: CSSProperties = {
  ...roleFont('note'), fontFamily: font.family, color: colors.brownText, lineHeight: 1.4,
};

/** The pausemark, on this card's own paper: a step back UP to the plate, like the ghost pill. */
const PAUSEMARK_STYLE: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: PLATE,
  borderRadius: 999,
  padding: '4px 10px',
  ...roleFont('small'),
  fontFamily: font.family,
  fontWeight: 800,
  color: colors.brownText,
};

const PAIR_STYLE: CSSProperties = { display: 'flex', gap: 8, marginTop: 2 };

export interface ResumeCardProps {
  /** The order the held job was given, as it was filed. */
  order: string;
  /** Where the work stopped, in the same words the paused ticket's own mark uses. */
  pausemark?: string;
  /** What is already on the map, where the job's plan can say it. Absent is the ordinary case. */
  note?: string;
  /** WHY THE HOLD CANNOT BE LIFTED. Present, the card draws no Resume and offers the repair instead;
   *  absent, the offer is live. */
  blocked?: string;
  /** Continue the held job. Ignored while `blocked` stands — that face has nothing to continue with. */
  onResume?: () => void;
  /** The blocked face's repair, which is the banner's own `fix-key` said on the card. */
  onFixKey?: () => void;
  /** Put the job away. It FILES rather than dropping: a held job the user declines still owes them a
   *  record, and the past-jobs row is what it becomes (escape invariant 2). */
  onSetAside?: () => void;
}

export function ResumeCard({ order, pausemark, note, blocked, onResume, onFixKey, onSetAside }: ResumeCardProps) {
  const t = useT();
  const offering = blocked === undefined && onResume !== undefined;

  return (
    <div data-testid="resume-card" data-blocked={blocked === undefined ? 'false' : 'true'} style={CARD_STYLE}>
      <div data-testid="resume-order" style={ORDER_STYLE}>{order}</div>
      {pausemark !== undefined && (
        <span data-testid="resume-pausemark" style={PAUSEMARK_STYLE}>
          <Icon id="pw-pause" size={12} />
          {pausemark}
        </span>
      )}
      {note !== undefined && <div data-testid="resume-note" style={NOTE_STYLE}>{note}</div>}
      {blocked !== undefined && <div data-testid="resume-blocked" style={NOTE_STYLE}>{blocked}</div>}
      {/* A row with nothing in it is a reserved seat for a control that does not exist, so an
          unwired card draws no band at all. */}
      {(offering || onFixKey !== undefined || onSetAside !== undefined) && (
        <div style={PAIR_STYLE}>
          {offering && (
            <button
              type="button"
              data-testid="resume-resume"
              onClick={onResume}
              style={RESUME_PRIMARY}
            >
              {t('agent3.action_resume')}
            </button>
          )}
          {blocked !== undefined && onFixKey !== undefined && (
            <button
              type="button"
              data-testid="resume-fix-key"
              onClick={onFixKey}
              style={RESUME_PRIMARY}
            >
              {t('agent3.banner_action_fix_key')}
            </button>
          )}
          {onSetAside !== undefined && (
            <button
              type="button"
              data-testid="resume-set-aside"
              onClick={onSetAside}
              style={{ ...windowPill('quiet', false, 'inset'), boxShadow: 'none' }}
            >
              {t(blocked === undefined ? 'agent3.action_for_later' : 'agent3.action_set_aside')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
