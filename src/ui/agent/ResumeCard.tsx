/*
 * Offers a held job for continuation without duplicating its operation history. The card shows the
 * order, pause point and any work summary. A blocked job replaces Resume with its repair action.
 * Already-held jobs do not offer Pause because pausing only takes effect at a call boundary.
 */
import type { CSSProperties } from 'react';
import { RESUME_PRIMARY } from './atoms';
import { Icon } from './icons';
import { CARD_PAD, edge, statePaper } from './tokens';
import { INK, PLATE } from '../design/tokens';
import { colors, font, mixHex } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowPill } from '../design/window-skin';
import { useT } from '../../i18n/context';

/** A subdued wait-state tint that keeps the card distinct from warnings. */
const RESUME_PAPER = mixHex(statePaper.wait, PLATE, 0.42);

const CARD_STYLE: CSSProperties = {
  background: RESUME_PAPER,
  // `edge` already contains the complete border shorthand.
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
  ...roleFont('menu'), fontFamily: font.family, color: INK, lineHeight: 1.35,
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
  /** Reason continuation is unavailable. When present, the card offers repair instead of Resume. */
  blocked?: string;
  /** Continue the held job. Hidden while `blocked` is present. */
  onResume?: () => void;
  /** The blocked face's repair, which is the banner's own `fix-key` said on the card. */
  onFixKey?: () => void;
  /** Move the held job into past jobs without discarding its record. */
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
