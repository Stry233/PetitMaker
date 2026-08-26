/*
 * model-prose.tsx — the model's own words, rendered as the markdown they are written in.
 *
 * A MODEL WRITES MARKDOWN WHETHER OR NOT IT IS ASKED TO, and a card that draws that text as one flat
 * string tells two lies about it: every `\n\n` collapses, so a five-step answer reads as one wall,
 * and the emphasis markers stand in the prose as `**` and backticks. Stripping the markers is not the
 * alternative — that alters the words — so the answer is to RENDER them.
 *
 * THE PARSER IS THE HOUSE'S ONE PARSER (`legal/markdown.ts`): a whitelist grammar with no raw HTML,
 * no nested inline spans and a scheme allowlist, already the source of both legal-document emitters
 * and pinned for parity between them. This is a third emitter over the same node tree, in the panel's
 * own rungs rather than the documents' — so the constrained grammar is shared and nothing here has to
 * be trusted to be safe on its own.
 *
 * WITH ONE DEPARTURE, and it is about who wrote the text. A legal document's links are ours; these
 * are the model's, and a live anchor pointing wherever a model chose is a navigation the user did not
 * ask for on a surface that looks like the app talking. So a link renders as its own visible TEXT,
 * href dropped — no word altered, nothing to press.
 *
 * TWO SHAPES, because the two seats are different. `ModelProse` is the BODY: paragraphs, lists and
 * the rest as blocks, for the answer paper. `inlineProseRuns` is one clamped run for the says line,
 * where the box is two lines of a card and a block sequence would break the clamp — the inline
 * emphasis is rendered and the block breaks survive as line breaks (`INLINE_PROSE_STYLE`).
 *
 * WHICH SURFACES USE IT, AND WHY THE REST DO NOT. The panel draws text from four authors and only one
 * of them writes markdown, so the answer is a decision per seat rather than a sweep:
 *
 * - `ModelProse` — the ANSWER PAPER's body and the receipt's closing words (`AnswerPaper`,
 *   `FlipTicket`'s two summary seats), and the THOUGHTS BOX. All three are a passage the model wrote
 *   at length: steps, a table of candidates, an id in backticks.
 * - `inlineProseRuns` — the SAYS LINE, which is the same author in a two-line box. Its emphasis is
 *   drawn and its breaks are kept; nothing becomes a block, because the clamp is the seat.
 * - PLAIN, and each for its own reason: a PLAN STAGE LABEL is a name, not prose, and every seat that
 *   holds one is a single clipped line — marks in it would be noise in a list. A GATE's sentence and
 *   a DELEGATE's lane line are the APP's own words with a model fragment interpolated, so parsing
 *   them would let a stray asterisk from that fragment restyle a sentence the app wrote. The
 *   COMPOSER's suggestion ghost is one nowrap line of text the user is about to overwrite. A STEER
 *   note and a gate's answer are the USER's words. An OP ROW's detail is the tool's own output.
 */
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { parseLegalMarkdown, type Inline, type MdNode } from '../../legal/markdown';
import { colors } from '../design/styles';
import { PLATE } from '../design/tokens';

/** A code span, at the one rung a chip of machine text earns beside prose. */
const CODE: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.92em',
  background: PLATE,
  borderRadius: 4,
  padding: '1px 4px',
};

const BLOCK: CSSProperties = { margin: 0 };
const LIST: CSSProperties = { ...BLOCK, paddingLeft: 20 };
/** A model's own heading is a LEAD LINE and not a rung of its own: the card already owns the
 *  hierarchy around this text, and a 20px h1 inside an answer would outshout the order above it. */
const LEAD: CSSProperties = { ...BLOCK, fontWeight: 700 };
const QUOTE: CSSProperties = { ...BLOCK, paddingLeft: 10, borderLeft: `2px solid ${colors.brownText}`, opacity: 0.9 };
const RULE: CSSProperties = { border: 'none', borderTop: `1px solid ${colors.brownText}`, opacity: 0.35, margin: 0 };
const ROW: CSSProperties = { display: 'flex', gap: 8 };
const CELL: CSSProperties = { flex: 1, minWidth: 0 };

/** One inline run. `link` keeps its words and loses its href — see the file header. */
function inlineNode(node: Inline, key: number): ReactNode {
  if (node.t === 'strong') return <strong key={key}>{node.text}</strong>;
  if (node.t === 'em') return <em key={key}>{node.text}</em>;
  if (node.t === 'code') return <code key={key} style={CODE}>{node.text}</code>;
  return <Fragment key={key}>{node.text}</Fragment>;
}

function inlineRun(children: Inline[]): ReactNode[] {
  return children.map((child, i) => inlineNode(child, i));
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
          <div style={ROW}>{node.header.map((cell, i) => <span key={i} style={{ ...CELL, fontWeight: 700 }}>{inlineRun(cell)}</span>)}</div>
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
  return (
    <div
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      // `overflow-wrap` inherits, so one declaration covers every block: a model's own 500-char URL
      // or id has no space for the line breaker, and without this it walks out of the card.
      style={{ display: 'flex', flexDirection: 'column', gap: 8, overflowWrap: 'anywhere', ...style }}
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
        ...inlineRun(item),
      ]);
    case 'blockquote':
      return node.children.flatMap((line) => inlineRun(line));
    case 'table':
      return [...node.header, ...node.rows.flat()].flatMap((cell) => inlineRun(cell));
    default:
      return inlineRun(node.children);
  }
}

/** The one style a seat rendering `inlineProseRuns` must carry, so the breaks it emits are drawn —
 *  and so an unbroken token wraps inside the seat's clamp instead of being clipped mid-word.
 *  Kept beside the runs rather than spelled at each seat: the two are one contract. */
export const INLINE_PROSE_STYLE: CSSProperties = { whiteSpace: 'pre-line', overflowWrap: 'anywhere' };
