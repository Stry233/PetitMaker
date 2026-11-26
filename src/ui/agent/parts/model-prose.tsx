/*
 * Renders model-authored Markdown through the constrained parser and emitter legal documents use, in
 * the card's own look (`MODEL_LOOK`). Raw HTML is unsupported and model-authored links retain their
 * text without becoming navigable.
 * `ModelProse` emits block layout for long answers and reasoning; `inlineProseRuns` preserves inline
 * emphasis and line breaks for clamped status text. App-authored labels and user input remain plain.
 */
import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';
import { displayAgentText } from '../../../agent/panel';
import { translate, useT } from '../../../i18n/context';
import { inlineText, parseLegalMarkdown, type Inline, type MdNode } from '../../../legal/markdown';
import { radii } from '../../design/styles';
import { roleFont, roleSize, roleWeight, LINE_HEIGHT } from '../../design/text-weight';
import { MUTED, PLATE } from '../../design/tokens';
import { useStreamedText } from '../hooks/use-streamed-text';
import { recede } from '../panel-skin';
import { markdownBlocks, markdownInline, type MarkdownLook } from '../../primitives/LegalMarkdown';

/** A code span, a rung under the prose round it. */
const CODE: CSSProperties = {
  fontFamily: 'monospace',
  fontSize: roleSize('chip'),
  fontWeight: 400,
  background: PLATE,
  borderRadius: radii.sm,
  padding: '2px 4px',
};

const EMPHASIS: CSSProperties = { fontWeight: `var(--model-emphasis-weight, ${roleWeight('label')})` };

const BLOCK: CSSProperties = { margin: 0 };
/** Model headings use a lead line without changing the card's surrounding hierarchy. */
const LEAD: CSSProperties = { ...BLOCK, ...roleFont('head'), lineHeight: LINE_HEIGHT.snug, marginTop: 4 };
/** A table's cells keep their row, which is the whole of what a table says: the header leads and
 *  each row's cells share the width, nothing joined into a sentence it was never written as. */
const CELL: CSSProperties = { padding: '0 8px 4px 0', textAlign: 'left', verticalAlign: 'top' };

/** The model's prose in the card's own rung: links keep their visible text but not their href. */
const MODEL_LOOK: MarkdownLook = {
  heading: () => ({ tag: 'h3', style: LEAD }),
  p: BLOCK,
  list: { ...BLOCK, paddingLeft: 20 },
  blockquote: { ...BLOCK, paddingLeft: 10, borderLeft: `2px solid ${MUTED}`, opacity: recede.near },
  hr: { border: 'none', borderTop: `1px solid ${MUTED}`, opacity: recede.rule, margin: 0 },
  tableWrap: BLOCK,
  table: { borderCollapse: 'collapse', tableLayout: 'fixed', width: '100%' },
  th: { ...CELL, ...EMPHASIS },
  td: CELL,
  code: CODE,
  strong: EMPHASIS,
  link: (node, key) => <Fragment key={key}>{node.text}</Fragment>,
};

function textRuns(node: MdNode): Inline[][] {
  switch (node.t) {
    case 'hr': return [];
    case 'ul': case 'ol': return node.items;
    case 'blockquote': return node.children;
    case 'table': return [...node.header, ...node.rows.flat()];
    default: return [node.children];
  }
}

/** Revealing parsed words keeps complete Markdown delimiters from flashing as literal text. */
function revealNodes(nodes: MdNode[], remaining: number): MdNode[] {
  const take = (children: Inline[]): Inline[] => children.flatMap(child => {
    const text = child.text.slice(0, remaining);
    remaining -= text.length;
    return text ? [{ ...child, text }] : [];
  });
  const groups = (runs: Inline[][]): Inline[][] => runs.map(take).filter(run => run.length > 0);
  return nodes.flatMap((node): MdNode[] => {
    if (remaining === 0) return [];
    switch (node.t) {
      case 'hr': return [node];
      case 'ul': case 'ol': return [{ ...node, items: groups(node.items) }];
      case 'blockquote': return [{ ...node, children: groups(node.children) }];
      case 'table': {
        const header = node.header.map(take);
        const rows = node.rows.flatMap(row => remaining > 0 ? [row.map(take)] : []);
        return [{ ...node, header, rows }];
      }
      default: return [{ ...node, children: take(node.children) }];
    }
  });
}

/** The model's text as blocks, in whatever rung the caller's own `style` sets. */
export function ModelProse({ text, style, testId, streaming = false }: {
  text: string;
  /** The seat's own type rung and ink; the block spacing is this component's. */
  style?: CSSProperties;
  testId?: string;
  streaming?: boolean;
}) {
  const t = useT();
  const nodes = useMemo(() => parseLegalMarkdown(displayAgentText(text, t)), [text, t]);
  const words = useMemo(() => nodes.flatMap(textRuns).map(inlineText).join(''), [nodes]);
  const visible = useStreamedText(words, streaming);
  const revealed = streaming && visible.length < words.length ? revealNodes(nodes, visible.length) : nodes;
  return (
    <div
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      // `overflow-wrap` inherits, so one declaration covers every block: a model's own 500-char URL
      // or id has no space for the line breaker, and without this it walks out of the card.
      style={{ ...roleFont('body'), display: 'flex', flexDirection: 'column', gap: 8, overflowWrap: 'anywhere', ...style }}
    >
      {markdownBlocks(revealed, MODEL_LOOK)}
    </div>
  );
}

/** Every block's own words, run together with the line breaks between them — for a seat that is one
 *  clamped line of a card. A list item keeps its markdown marker, which is the only thing in that
 *  box that can say it is one. */
export function inlineProseRuns(text: string, t = translate): ReactNode[] {
  const blocks: ReactNode[][] = [];
  for (const node of parseLegalMarkdown(displayAgentText(text, t))) {
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
        ...markdownInline(item, MODEL_LOOK, `li-${j}-`),
      ]);
    case 'blockquote':
      return node.children.flatMap((line, i) => markdownInline(line, MODEL_LOOK, `quote-${i}-`));
    case 'table':
      return [...node.header, ...node.rows.flat()].flatMap((cell, i) => markdownInline(cell, MODEL_LOOK, `cell-${i}-`));
    default:
      return markdownInline(node.children, MODEL_LOOK);
  }
}

/** The one style a seat rendering `inlineProseRuns` must carry, so the breaks it emits are drawn —
 *  and so an unbroken token wraps inside the seat's clamp instead of being clipped mid-word.
 *  Kept beside the runs rather than spelled at each seat: the two are one contract. */
export const INLINE_PROSE_STYLE: CSSProperties = { whiteSpace: 'pre-line', overflowWrap: 'anywhere' };
