/** Provider reasoning uses constrained Markdown; persisted excerpts may be incomplete. */
import { Fragment, useRef, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { fmtClock } from './dock-face';
import { Icon } from './icons';
import { ModelProse } from './model-prose';
import { Disclosure } from '../primitives/Disclosure';
import { ScrollArea } from '../primitives/ScrollArea';
import { panelTint, metaInk } from './tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { ThoughtTurn } from '../../agent/core/project-view';
import { useFollowNewest } from './use-follow-newest';

/** Maximum transcript height in CSS pixels; percentage heights cannot resolve in this flex scroller. */
export const THOUGHTS_MAX_HEIGHT = 200;

const BOX_STYLE: CSSProperties = {
  maxHeight: THOUGHTS_MAX_HEIGHT,
  overscrollBehavior: 'contain',
  background: panelTint.chip,
  borderRadius: 10,
  ...roleFont('body'),
  fontFamily: font.family,
  color: colors.brownText,
  lineHeight: 1.5,
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
export function ThoughtsBox({ text, excerpt, spaceBefore = 0, streaming = false }: { text: string; excerpt?: boolean; spaceBefore?: number; streaming?: boolean }) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  useFollowNewest(scrollRef, text, '', true, 'start');
  return (
    <Disclosure testId="thoughts-box-frame" motionId="panel.thoughts.open" spaceBefore={spaceBefore}>
      <ScrollArea ref={scrollRef} data-testid="thoughts-box" gutter="stable" fade="none" style={BOX_STYLE}
        viewportStyle={{ overscrollBehavior: 'contain' }} contentStyle={{ padding: '8px 10px' }}>
        <ModelProse text={text} style={PROSE_STYLE} streaming={streaming} />
        {excerpt === true && <span data-testid="thoughts-excerpt-note" style={NOTE_STYLE}>{t('agent3.thoughts_excerpt')}</span>}
      </ScrollArea>
    </Disclosure>
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
