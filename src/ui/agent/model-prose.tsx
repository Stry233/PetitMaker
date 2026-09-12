/*
 * Renders model-authored Markdown through the same constrained parser used by legal documents. Raw
 * HTML is unsupported and model-authored links retain their text without becoming navigable.
 * `ModelProse` emits block layout for long answers and reasoning; `inlineProseRuns` preserves inline
 * emphasis and line breaks for clamped status text. App-authored labels and user input remain plain.
 */
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { parseLegalMarkdown, type Inline, type MdNode } from '../../legal/markdown';
import { colors } from '../design/styles';
import { useFrameReadableWeight } from '../shell/use-frame-zoom';
import { TEXT_ROLES, roleWeight } from '../design/text-weight';
import { PLATE } from '../design/tokens';

/** A code span, at the one rung a chip of machine text earns beside prose. */
const CODE: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.92em',
  fontWeight: 400,
  background: PLATE,
  borderRadius: 4,
  padding: '1px 4px',
};

const EMPHASIS: CSSProperties = { fontWeight: `var(--model-emphasis-weight, ${roleWeight('note')})` };

const BLOCK: CSSProperties = { margin: 0 };
const LIST: CSSProperties = { ...BLOCK, paddingLeft: 20 };
/** Model headings use a lead line without changing the card's surrounding hierarchy. */
const LEAD: CSSProperties = { ...BLOCK, ...EMPHASIS };
const QUOTE: CSSProperties = { ...BLOCK, paddingLeft: 10, borderLeft: `2px solid ${colors.brownText}`, opacity: 0.9 };
const RULE: CSSProperties = { border: 'none', borderTop: `1px solid ${colors.brownText}`, opacity: 0.35, margin: 0 };
const ROW: CSSProperties = { display: 'flex', gap: 8 };
const CELL: CSSProperties = { flex: 1, minWidth: 0 };

/** One inline run. Link nodes keep their visible text but not their href. */
function inlineNode(node: Inline, key: string | number): ReactNode {
  if (node.t === 'strong') return <strong key={key} style={{ ...EMPHASIS }}>{node.text}</strong>;
  if (node.t === 'em') return <em key={key}>{node.text}</em>;
  if (node.t === 'code') return <code key={key} style={CODE}>{node.text}</code>;
  return <Fragment key={key}>{node.text}</Fragment>;
}

function inlineRun(children: Inline[], keyPrefix = ''): ReactNode[] {
  return children.map((child, i) => inlineNode(child, `${keyPrefix}${i}`));
}

function blockNode(node: MdNode, key: number): ReactNode {
  switch (node.t) {
    case 'h':
      return <p key={key} style={LEAD}>{inlineRun(node.children)}</p>;
    case 'ul':
      return <ul key={key} style={LIST}>{node.items.map((item, i) => <li key={i}>{inlineRun(item)}</li>)}</ul>;
    case 'ol':
      return <ol key={key} style={LIST}>{node.items.map((item, i) => <li key={i}>{inlineRun(item)}</li>)}</ol>;
    case 'blockquote':
      return (
        <div key={key} style={QUOTE}>
          {node.children.map((line, i) => <p key={i} style={BLOCK}>{inlineRun(line)}</p>)}
        </div>
      );
    case 'hr':
      return <hr key={key} style={RULE} />;
    // A table's cells keep their ROW, which is the whole of what a table says: the header leads and
    // each row's cells share the width. Nothing is joined into a sentence with punctuation it was
    // never written with.
    case 'table':
      return (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={ROW}>{node.header.map((cell, i) => <span key={i} style={{ ...CELL, ...EMPHASIS }}>{inlineRun(cell)}</span>)}</div>
          {node.rows.map((row, i) => (
            <div key={i} style={ROW}>{row.map((cell, j) => <span key={j} style={CELL}>{inlineRun(cell)}</span>)}</div>
          ))}
        </div>
      );
    default:
      return <p key={key} style={BLOCK}>{inlineRun(node.children)}</p>;
  }
}

/** The model's text as blocks, in whatever rung the caller's own `style` sets. */
export function ModelProse({ text, style, testId }: {
  text: string;
  /** The seat's own type rung and ink; the block spacing is this component's. */
  style?: CSSProperties;
  testId?: string;
}) {
  const weightAt = useFrameReadableWeight();
  const emphasis = {
    '--model-emphasis-weight': weightAt(700, typeof style?.fontSize === 'number' ? style.fontSize : TEXT_ROLES.note.px),
  } as CSSProperties;
  return (
    <div
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      // `overflow-wrap` inherits, so one declaration covers every block: a model's own 500-char URL
      // or id has no space for the line breaker, and without this it walks out of the card.
      style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowWrap: 'anywhere', ...style, ...emphasis }}
    >
      {parseLegalMarkdown(text).map((node, i) => blockNode(node, i))}
    </div>
  );
}

/** Every block's own words, run together with the line breaks between them — for a seat that is one
 *  clamped line of a card. A list item keeps its markdown marker, which is the only thing in that
 *  box that can say it is one. */
export function inlineProseRuns(text: string): ReactNode[] {
  const blocks: ReactNode[][] = [];
  for (const node of parseLegalMarkdown(text)) {
    const runs = runsOf(node);
    if (runs.length > 0) blocks.push(runs);
  }
  // One keyed fragment per block, which is what scopes each block's own run keys to it.
  return blocks.map((runs, i) => (
    <Fragment key={i}>
      {i > 0 ? '\n' : null}
      {runs}
    </Fragment>
  ));
}

/** One block's words as inline runs, with a list's items on their own lines behind the marker only
 *  that box can say they have. A rule has no words at all and contributes none. */
function runsOf(node: MdNode): ReactNode[] {
  switch (node.t) {
    case 'hr':
      return [];
    case 'ul':
    case 'ol':
      return node.items.flatMap((item, j) => [
        <Fragment key={`li-${j}`}>{`${j > 0 ? '\n' : ''}${node.t === 'ol' ? `${j + 1}. ` : '- '}`}</Fragment>,
        ...inlineRun(item, `li-${j}-`),
      ]);
    case 'blockquote':
      return node.children.flatMap((line, i) => inlineRun(line, `quote-${i}-`));
    case 'table':
      return [...node.header, ...node.rows.flat()].flatMap((cell, i) => inlineRun(cell, `cell-${i}-`));
    default:
      return inlineRun(node.children);
  }
}

/** The one style a seat rendering `inlineProseRuns` must carry, so the breaks it emits are drawn —
 *  and so an unbroken token wraps inside the seat's clamp instead of being clipped mid-word.
 *  Kept beside the runs rather than spelled at each seat: the two are one contract. */
export const INLINE_PROSE_STYLE: CSSProperties = { whiteSpace: 'pre-line', overflowWrap: 'anywhere' };
