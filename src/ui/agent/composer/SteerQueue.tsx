/*
 * Renders every note queued for the next step, showing three until the user expands the list. Chips
 * scroll separately so the hidden-count control remains visible. Recalled notes shrink in place;
 * delivered notes lift as they leave.
 */
import { Disclosure, DisclosureStack } from '../../primitives/Disclosure';
import { ScrollArea } from '../../primitives/ScrollArea';
import { useCallback, useRef, useState, type CSSProperties } from 'react';
import { ActionButton, type ActionButtonProps } from '../../primitives/ActionButton';
import { AnimatePresence, motion, useIsPresent, useReducedMotionConfig } from 'framer-motion';
import { Icon } from '../parts/sprite';
import { amplitude, framerMotion } from '../../design/motion';
import { ACTIVE, INK, MUTED, SURFACE_SECONDARY } from '../../design/tokens';
import { cursors, font, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';

/** How many chips stand before the rest collapse into the count line. */
const STEER_VISIBLE_CAP = 3;

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
};

const CHIP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flex: '0 0 auto',
  minHeight: CHIP_HEIGHT,
  boxSizing: 'border-box',
  background: ACTIVE,
  color: INK,
  borderRadius: radii.pill,
  padding: '6px 6px 6px 10px',
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
  gap: 4,
  borderRadius: radii.pill,
  border: 'none',
  padding: '4px 12px',
  ...roleFont('small'),
  fontFamily: font.family,
  color: MUTED,
  cursor: cursors.clickable,
  boxShadow: 'none',
};

const CROSS_STYLE: CSSProperties = {
  border: 'none', background: 'none', color: INK, flex: '0 0 auto',
  display: 'inline-flex', padding: 0, cursor: cursors.clickable,
};

interface SteerQueueProps {
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
      <ScrollArea data-testid="steer-chips" gutter="stable" fade="none" style={CHIPS_STYLE}>
        <DisclosureStack gap={GAP}>
          <AnimatePresence initial={false}>
            {shown.map((steer) => {
              const takenBack = recalled.current === steer.seq;
              return (
                <Disclosure key={steer.seq} motionId="panel.steer.chip">
                  <motion.div
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
                    <span style={{ color: MUTED, flex: '0 0 auto' }}>{t('agent.steer_at_next_step')}</span>
                    {onRecall && (
                      <RecallButton
                        data-testid="panel-steer-recall"
                        aria-label={t('agent.steer_take_back')}
                        title={t('agent.steer_take_back')}
                        onClick={() => recall(steer.seq)}
                        style={CROSS_STYLE}
                      >
                        <Icon id="pw-cross" size={11} />
                      </RecallButton>
                    )}
                  </motion.div>
                </Disclosure>
              );
            })}
          </AnimatePresence>
        </DisclosureStack>
      </ScrollArea>
      {more && (
        <ActionButton
          data-testid="steer-more"
          interaction="pill"
          onClick={() => setExpanded(more === 'expand')}
          fill={SURFACE_SECONDARY}
          hoverFill={ACTIVE}
          style={MORE_STYLE}
        >
          {more === 'expand' ? t('agent.steer_more', { n: hidden }) : t('agent.steer_fewer')}
        </ActionButton>
      )}
    </div>
  );
}

/** A leaving chip's cross takes no press: it is already on its way out. */
function RecallButton(props: Omit<ActionButtonProps, 'disabled'>) {
  const present = useIsPresent();
  // A departing chip's cross keeps its ink; it only stops answering.
  return <ActionButton {...props} interaction="badge" disabled={!present} style={{ ...props.style, ...(present ? {} : { opacity: 1 }) }} />;
}
