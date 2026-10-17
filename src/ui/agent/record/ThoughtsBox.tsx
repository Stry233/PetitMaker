/** Provider reasoning uses constrained Markdown; persisted excerpts may be incomplete. */
import { Fragment, useRef, type CSSProperties } from 'react';
import { AnimatePresence } from 'framer-motion';
import { fmtClock } from '../derive/clock';
import { Icon } from '../parts/sprite';
import { ModelProse } from '../parts/model-prose';
import { Disclosure } from '../../primitives/Disclosure';
import { ScrollArea } from '../../primitives/ScrollArea';
import { ActionButton } from '../../primitives/ActionButton';
import { panelTint, metaInk } from '../panel-skin';
import { font, radii } from '../../design/styles';
import { MUTED } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';
import type { ThoughtTurn } from '../../../agent/panel';
import { useFollowNewest } from '../hooks/use-follow-newest';

/** Maximum transcript height in CSS pixels; percentage heights cannot resolve in this flex scroller. */
const THOUGHTS_MAX_HEIGHT = 200;

const BOX_STYLE: CSSProperties = {
  maxHeight: THOUGHTS_MAX_HEIGHT,
  overscrollBehavior: 'contain',
  background: panelTint.chip,
  borderRadius: radii.md,
  ...roleFont('body'),
  fontFamily: font.family,
  color: MUTED,
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
export function ThoughtsBox(
  { text, excerpt, spaceBefore = 0, streaming = false }: { text: string; excerpt?: boolean; spaceBefore?: number; streaming?: boolean },
) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  useFollowNewest(scrollRef, text, '', true, 'start');
  return (
    <Disclosure testId="thoughts-box-frame" motionId="panel.thoughts.open" spaceBefore={spaceBefore}>
      <ScrollArea ref={scrollRef} data-testid="thoughts-box" gutter="stable" fade="none" style={BOX_STYLE}
        viewportStyle={{ overscrollBehavior: 'contain' }} contentStyle={{ padding: '8px 10px' }}>
        <ModelProse text={text} style={PROSE_STYLE} streaming={streaming} />
        {excerpt === true && <span data-testid="thoughts-excerpt-note" style={NOTE_STYLE}>{t('agent.thoughts_excerpt')}</span>}
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
  padding: '2px 8px',
  marginLeft: -2,
  borderRadius: radii.chip,
  border: 'none',
  ...roleFont('small'),
  fontFamily: font.family,
  color: MUTED,
};

/**
 * One turn's reasoning marker. Providers that expose no text still get a duration-only row. When
 * text is available, `text.length < chars` identifies a persisted excerpt.
 */
export function ThoughtRow(
  { mark, open, onToggle }: { mark: ThoughtTurn; open: boolean; onToggle: () => void },
) {
  const t = useT();
  const label = t('agent.thought_mark', { t: fmtClock(mark.ms / 1000) ?? '0:00' });
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
        <ActionButton
          data-testid="thought-mark"
          interaction="pill"
          aria-expanded={open}
          aria-label={t(open ? 'agent.thoughts_hide' : 'agent.thoughts_read')}
          title={t(open ? 'agent.thoughts_hide' : 'agent.thoughts_read')}
          onClick={onToggle}
          hoverFill={panelTint.chip}
          style={MARK_STYLE}
        >
          <span>{label}</span>
          <span style={{ display: 'inline-flex', transform: open ? 'rotate(180deg)' : undefined }}>
            <Icon id="pw-chevron" size={12} />
          </span>
        </ActionButton>
      </div>
      {/* Keep the box mounted through its closing animation. */}
      <AnimatePresence initial={false}>
        {open && <ThoughtsBox text={mark.text} excerpt={mark.text.length < mark.chars} />}
      </AnimatePresence>
    </Fragment>
  );
}
