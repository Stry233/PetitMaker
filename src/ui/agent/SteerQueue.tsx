/*
 * Renders every note queued for the next step, showing three until the user expands the list. Chips
 * scroll separately so the hidden-count control remains visible. Recalled notes shrink in place;
 * delivered notes lift as they leave.
 */
import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { Icon } from './icons';
import { amplitude, framerMotion } from './motion';
import { ACTIVE, INK } from '../design/tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';

/** How many chips stand before the rest collapse into the count line. */
export const STEER_VISIBLE_CAP = 3;

/** One chip's own height, and the gap between two of them, in css px. */
const CHIP_HEIGHT = 36;
const GAP = 6;
/** The count line's own height: its two 5px gutters over a `small` line. */
const MORE_HEIGHT = 27;

/** Height for three chips, their gaps and the expand control. */
const ZONE_MAX = STEER_VISIBLE_CAP * CHIP_HEIGHT + (STEER_VISIBLE_CAP - 1) * GAP + GAP + MORE_HEIGHT;

const CHIP_GROWTH = amplitude('panel.steer.chip') ?? 0;
const DELIVER_LIFT = amplitude('panel.steer.deliver') ?? 0;

const ZONE_STYLE: CSSProperties = {
  flex: '0 1 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: GAP,
  maxHeight: ZONE_MAX,
  minHeight: 0,
};

const CHIPS_STYLE: CSSProperties = {
  flex: '0 1 auto',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: GAP,
  overflowY: 'auto',
};

const CHIP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  flex: '0 0 auto',
  minHeight: CHIP_HEIGHT,
  boxSizing: 'border-box',
  background: ACTIVE,
  color: INK,
  borderRadius: 999,
  padding: '7px 6px 7px 10px',
  ...roleFont('chip'),
  fontFamily: font.family,
};

const TEXT_STYLE: CSSProperties = {
  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const MORE_STYLE: CSSProperties = {
  alignSelf: 'flex-start',
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  background: colors.surfaceSecondary,
  borderRadius: 999,
  border: 'none',
  padding: '5px 12px',
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
  cursor: cursors.clickable,
  boxShadow: 'none',
};

const CROSS_STYLE: CSSProperties = {
  border: 'none', background: 'none', color: INK, flex: '0 0 auto',
  display: 'inline-flex', padding: 0, cursor: cursors.clickable,
};

export interface SteerQueueProps {
  /** `PanelView.queuedSteers` — every note with neither a delivery nor a recall behind it. */
  steers: readonly { seq: number; text: string }[];
  /** Take one note back, by its own seq. Absent, the chips draw no cross. */
  onRecall?: (steerSeq: number) => void;
}

export function SteerQueue({ steers, onRecall }: SteerQueueProps) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [expanded, setExpanded] = useState(false);
  /** Identifies a recalled note so its exit differs from normal delivery. */
  const recalled = useRef<number | null>(null);

  const recall = useCallback((seq: number) => {
    recalled.current = seq;
    onRecall?.(seq);
  }, [onRecall]);

  const cap = expanded ? steers.length : STEER_VISIBLE_CAP;
  const shown = steers.slice(0, cap);
  const hidden = steers.length - shown.length;
  // Keep the collapse control only when expansion changed what is visible.
  const more = hidden > 0 ? 'expand' : expanded && steers.length > STEER_VISIBLE_CAP ? 'collapse' : null;

  return (
    // Preserve the zone in the layout while the queue is empty.
    <div data-testid="panel-steer-zone" style={ZONE_STYLE}>
      <div data-testid="steer-chips" style={CHIPS_STYLE}>
        <AnimatePresence initial={false}>
          {shown.map((steer) => {
            const takenBack = recalled.current === steer.seq;
            return (
              <motion.div
                key={steer.seq}
                data-testid="panel-steer-chip"
                data-seq={steer.seq}
                initial={{ opacity: 0, scale: 1 - CHIP_GROWTH }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={takenBack || reduced
                  ? { opacity: 0, scale: 1 - CHIP_GROWTH }
                  : { opacity: 0, scale: 1 - CHIP_GROWTH, y: -DELIVER_LIFT }}
                transition={framerMotion(takenBack ? 'panel.steer.chip' : 'panel.steer.deliver')}
                style={CHIP_STYLE}
              >
                <span style={{ color: INK, display: 'inline-flex', flex: '0 0 auto' }}>
                  <Icon id="pw-note" size={14} />
                </span>
                <span style={TEXT_STYLE}>{steer.text}</span>
                <span style={{ color: colors.brownText, flex: '0 0 auto' }}>{t('agent3.steer_at_next_step')}</span>
                {onRecall && (
                  <button
                    type="button"
                    data-testid="panel-steer-recall"
                    aria-label={t('agent3.steer_take_back')}
                    title={t('agent3.steer_take_back')}
                    onClick={() => recall(steer.seq)}
                    style={CROSS_STYLE}
                  >
                    <Icon id="pw-cross" size={11} />
                  </button>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
      {more && (
        <button
          type="button"
          data-testid="steer-more"
          onClick={() => setExpanded(more === 'expand')}
          style={MORE_STYLE}
        >
          {more === 'expand' ? t('agent3.steer_more', { n: hidden }) : t('agent3.steer_fewer')}
        </button>
      )}
    </div>
  );
}
