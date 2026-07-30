/**
 * BuildTicket — the small-job build card, a FLIP card (spec §UI.2):
 * front = glyph tile + title/sub + tick rail + Undo chip + flip button (both
 * appear once done); back = "How it was built" kicker + step list (including
 * amber adjusted-approach steps) + flip back. rotateY 180°, 550ms, spring-ish
 * curve; the back face is absolutely overlaid so the front sets the height.
 * `.undone` dims the card 45% and stamps it; the undo chip disappears.
 */
import type { CSSProperties } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import type { Step, TicketEntry } from '../../../../agent/session';
import { useT } from '../../../../i18n/context';
import { colors as C, inkTint, font, cursors } from '../../../styles';
import { usePx } from '../../scale';
import {
  CARD_LINE,
  CheckIcon,
  EntryShell,
  FlipIcon,
  OK_GREEN,
  Rail,
  REVERT_AMBER,
  REVERT_TEXT,
  SummaryFold,
  UndoChip,
  VerbGlyph,
} from '../atoms';

function FlipBtn({ onClick, label }: { onClick: () => void; label: string }) {
  const { px } = usePx();
  return (
    <motion.button
      data-testid="flipbtn"
      aria-label={label}
      whileHover={{ rotate: -12 }}
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      style={{
        border: 'none',
        appearance: 'none',
        background: C.surfaceSecondary,
        color: C.textSecondary,
        width: px(48),
        height: px(48),
        borderRadius: px(16),
        cursor: cursors.clickable,
        display: 'grid',
        placeItems: 'center',
        flex: '0 0 auto',
        padding: 0,
      }}
    >
      <FlipIcon size={px(26)} />
    </motion.button>
  );
}

export function BuildTicket({
  entry,
  latest,
  onUndo,
  onFlip,
  onToggleSummary,
}: {
  entry: TicketEntry;
  /** Newest live entry: its summary starts expanded; older cards fold it. */
  latest?: boolean;
  onUndo: (id: number) => void;
  onFlip: (id: number) => void;
  onToggleSummary?: (id: number) => void;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const { px, pxf, fw } = usePx();

  const done = !entry.working && entry.rail.every((tk) => tk.s !== 'run');
  const steps: Step[] = entry.steps ?? entry.rail.map((tk) => ({ s: tk.s === 'revert' ? 'revert' : 'ok', t: tk.t }));

  const face: CSSProperties = {
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    background: C.white,
    border: `${px(2)}px solid ${CARD_LINE}`,
    borderRadius: px(32),
    padding: `${px(20)}px ${px(24)}px`,
    boxShadow: `0 ${px(6)}px ${px(16)}px ${inkTint(0.06)}`,
    display: 'flex',
    flexDirection: 'column',
    gap: px(16),
  };

  return (
    <EntryShell undone={entry.undone} testId="ticket">
      <div style={{ perspective: px(1600) }}>
        <motion.div
          data-testid="ticket-inner"
          data-flipped={entry.flipped ? 'true' : 'false'}
          initial={false}
          animate={{ rotateY: entry.flipped ? 180 : 0 }}
          transition={reduced ? { duration: 0 } : { duration: 0.55, ease: [0.34, 1.4, 0.5, 1] }}
          style={{ position: 'relative', transformStyle: 'preserve-3d' }}
        >
          {/* front */}
          <div style={face}>
            <div style={{ display: 'flex', alignItems: 'center', gap: px(18) }}>
              <span
                style={{
                  width: px(56),
                  height: px(56),
                  borderRadius: px(18),
                  background: entry.tile,
                  display: 'grid',
                  placeItems: 'center',
                  color: C.inkText,
                  flex: '0 0 auto',
                }}
              >
                <VerbGlyph icon={entry.icon} size={px(32)} />
              </span>
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: pxf(29),
                  fontWeight: fw(800),
                  color: C.inkText,
                  fontFamily: font.family,
                }}
              >
                {entry.title}
                {entry.sub && (
                  <small
                    style={{ display: 'block', fontSize: pxf(23), fontWeight: fw(700), color: C.textSecondary }}
                  >
                    {entry.sub}
                  </small>
                )}
              </div>
              {done && (
                <span
                  data-testid="ticket-check"
                  style={{
                    width: px(44),
                    height: px(44),
                    borderRadius: '50%',
                    background: OK_GREEN,
                    color: C.white,
                    display: 'grid',
                    placeItems: 'center',
                    flex: '0 0 auto',
                  }}
                >
                  <CheckIcon size={px(26)} />
                </span>
              )}
              {done && <FlipBtn onClick={() => onFlip(entry.id)} label={t('agent2.a11y_flip')} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: px(16) }}>
              <Rail rail={entry.rail} live={!done} />
              {done && entry.undoable && !entry.undone && (
                <UndoChip label={t('agent2.undo')} onClick={() => onUndo(entry.id)} />
              )}
            </div>
            {entry.revertnote && (
              <p style={{ margin: 0, fontSize: pxf(25), fontWeight: fw(700), color: REVERT_TEXT, fontFamily: font.family }}>
                {entry.revertnote}
              </p>
            )}
            {entry.now && (
              <p style={{ margin: 0, fontSize: pxf(25), fontWeight: fw(700), color: C.textSecondary, fontFamily: font.family }}>
                {entry.now}
              </p>
            )}
            {entry.summary && (
              <SummaryFold
                text={entry.summary}
                open={entry.summaryOpen ?? !!latest}
                onToggle={() => onToggleSummary?.(entry.id)}
              />
            )}
          </div>

          {/* back — absolutely overlaid so the front owns the card height */}
          <div
            className="pw-noscroll"
            data-testid="ticket-back"
            style={{ ...face, position: 'absolute', inset: 0, transform: 'rotateY(180deg)', overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: px(18) }}>
              <span
                style={{
                  flex: 1,
                  fontSize: pxf(19),
                  fontWeight: fw(800),
                  letterSpacing: '.09em',
                  textTransform: 'uppercase',
                  color: C.textSecondary,
                  fontFamily: font.family,
                }}
              >
                {t('agent2.how_built')}
              </span>
              <FlipBtn onClick={() => onFlip(entry.id)} label={t('agent2.a11y_flip')} />
            </div>
            {steps.map((st, i) => (
              <div
                key={i}
                data-testid="bk-step"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: px(16),
                  fontSize: pxf(24),
                  fontWeight: fw(700),
                  color: C.inkText,
                  fontFamily: font.family,
                }}
              >
                <span
                  style={{
                    width: px(36),
                    height: px(36),
                    borderRadius: px(12),
                    background: st.s === 'revert' ? REVERT_AMBER : OK_GREEN,
                    color: C.white,
                    display: 'grid',
                    placeItems: 'center',
                    flex: '0 0 auto',
                    fontWeight: fw(900),
                    fontSize: pxf(23),
                  }}
                >
                  {st.s === 'revert' ? '!' : <CheckIcon size={px(20)} />}
                </span>
                {st.t}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </EntryShell>
  );
}
