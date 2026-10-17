/** The text a ghost input holds, painted with that input's real caret and selection. */
import { Fragment, type CSSProperties, type Ref } from 'react';
import { graphemes } from '../../../../core/base/text';
import { FIELD_SELECTION } from '../../../design/tokens';
import { GRAPHEME_ATTR } from './use-ghost-field';

/** A caret takes no room, so moving it never shifts the text: a zero-width slot the bar overflows evenly. */
const CARET_SLOT: CSSProperties = { display: 'flex', justifyContent: 'center', width: 0, height: '0.72em', flexShrink: 0 };
/** Each grapheme keeps its own spaces, which a flex item would otherwise trim. */
const GRAPHEME: CSSProperties = { whiteSpace: 'pre' };

/**
 * One span per grapheme between `start` and `end` (grapheme indices): a collapsed selection paints
 * the caret there while `focused`, a range paints its graphemes on `FIELD_SELECTION`. `moves`
 * remounts the caret so its blink restarts with each move, as a native caret's does.
 */
export function PaintedText({ text, start, end, focused, moves, caret, paintRef }: {
  text: string;
  start: number;
  end: number;
  focused: boolean;
  moves: number;
  /** The caret bar's own look, sized in the text's em; its blink is `.pw-caret-blink`. */
  caret: CSSProperties;
  paintRef: Ref<HTMLSpanElement>;
}) {
  const parts = graphemes(text);
  const collapsed = start === end;
  const bar = focused && collapsed ? (
    <span key={`caret-${moves}`} style={CARET_SLOT} data-testid="ghost-caret" data-at={start}>
      <span className="pw-caret-blink" style={{ ...caret, flexShrink: 0 }} />
    </span>
  ) : null;
  return (
    <span ref={paintRef} style={{ display: 'flex', alignItems: 'center' }}>
      {parts.map((part, i) => {
        const selected = focused && i >= start && i < end;
        return (
        <Fragment key={i}>
          {i === start ? bar : null}
          <span
            {...{ [GRAPHEME_ATTR]: i }}
            data-selected={selected ? '' : undefined}
            style={selected ? { ...GRAPHEME, background: FIELD_SELECTION } : GRAPHEME}
          >
            {part}
          </span>
        </Fragment>
        );
      })}
      {start >= parts.length ? bar : null}
    </span>
  );
}
