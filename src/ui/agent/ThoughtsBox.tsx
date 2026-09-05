/*
 * Displays provider-supplied reasoning on demand. The transcript is collapsed by default, rendered
 * with the panel's constrained Markdown renderer and capped in its own scroll area. An open box
 * disables the job record's automatic scroll-follow so incoming updates do not move the text being
 * read. Persisted excerpts are labelled as incomplete.
 */
import { Fragment, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { fmtClock } from './dock-face';
import { Icon } from './icons';
import { ModelProse } from './model-prose';
import { framerMotion } from './motion';
import { inkTint, metaInk } from './tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { ThoughtTurn } from '../../agent/core/project-view';

/** Maximum transcript height in CSS pixels; percentage heights cannot resolve in this flex scroller. */
export const THOUGHTS_MAX_HEIGHT = 200;

const BOX_STYLE: CSSProperties = {
  maxHeight: THOUGHTS_MAX_HEIGHT,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  background: inkTint.chip,
  borderRadius: 10,
  padding: '8px 10px',
  ...roleFont('note'),
  fontFamily: font.family,
  color: colors.brownText,
  lineHeight: 1.5,
  scrollbarWidth: 'thin',
};

/** Spacing between rendered Markdown blocks. */
const PROSE_STYLE: CSSProperties = { gap: 6 };

const NOTE_STYLE: CSSProperties = {
  display: 'block',
  marginTop: 6,
  color: metaInk.fact,
  ...roleFont('small'),
  fontFamily: font.family,
};

/** Reasoning retained for one turn. `excerpt` marks text truncated at the persistence boundary. */
export function ThoughtsBox({ text, excerpt }: { text: string; excerpt?: boolean }) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  return (
    <motion.div
      data-testid="thoughts-box-frame"
      // Animate to the measured content height, with overflow hidden during the reveal.
      initial={reduced ? false : { height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={framerMotion('panel.thoughts.open')}
      style={{ overflow: 'hidden', flex: '0 0 auto' }}
    >
      <div data-testid="thoughts-box" style={BOX_STYLE}>
        <ModelProse text={text} style={PROSE_STYLE} />
        {excerpt === true && <span data-testid="thoughts-excerpt-note" style={NOTE_STYLE}>{t('agent3.thoughts_excerpt')}</span>}
      </div>
    </motion.div>
  );
}

/** Compact reasoning marker within the operation list. */
const ROW_STYLE: CSSProperties = { display: 'flex', alignItems: 'center', minHeight: 22 };

const MARK_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  marginLeft: -2,
  borderRadius: 8,
  border: 'none',
  background: 'none',
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
};

/**
 * One turn's reasoning marker. Providers that expose no text still get a duration-only row. When
 * text is available, `text.length < chars` identifies a persisted excerpt.
 */
export function ThoughtRow(
  { mark, open, onToggle }: { mark: ThoughtTurn; open: boolean; onToggle: () => void },
) {
  const t = useT();
  const label = t('agent3.thought_mark', { t: fmtClock(mark.ms / 1000) ?? '0:00' });
  if (mark.text === undefined) {
    return (
      <div data-testid="thought-row" style={ROW_STYLE}>
        <span style={{ ...MARK_STYLE, cursor: 'inherit' }}>{label}</span>
      </div>
    );
  }
  return (
    <Fragment>
      <div data-testid="thought-row" style={ROW_STYLE}>
        <button
          type="button"
          data-testid="thought-mark"
          aria-expanded={open}
          aria-label={t(open ? 'agent3.thoughts_hide' : 'agent3.thoughts_read')}
          title={t(open ? 'agent3.thoughts_hide' : 'agent3.thoughts_read')}
          onClick={onToggle}
          style={{ ...MARK_STYLE, cursor: cursors.clickable }}
        >
          <span>{label}</span>
          <span style={{ display: 'inline-flex', transform: open ? 'rotate(180deg)' : undefined }}>
            <Icon id="pw-chevron" size={12} />
          </span>
        </button>
      </div>
      {/* Keep the box mounted through its closing animation. */}
      <AnimatePresence initial={false}>
        {open && <ThoughtsBox text={mark.text} excerpt={mark.text.length < mark.chars} />}
      </AnimatePresence>
    </Fragment>
  );
}
