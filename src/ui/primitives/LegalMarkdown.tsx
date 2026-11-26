import { SUPPORTS_EXTERNAL_LINKS } from '../../platform/build/edition';
/**
 * The React emitter for the constrained Markdown node tree (`src/legal/markdown.ts`): `markdownBlocks`
 * draws a tree in a caller's look (each element's style and what a link becomes), and `LegalMarkdown`
 * is the in-app counterpart of the static HTML serializer (`markdown-html.ts`), the same source tree
 * in the same DOM shape (structural parity is unit-tested), styled from the `PROSE` map below. It
 * renders no wrapping element at the root (a `Fragment`), so its DOM output matches `renderHtml`'s
 * unwrapped block sequence exactly.
 *
 * Security: React escapes all text/attribute values by default, so nothing
 * here may use `dangerouslySetInnerHTML`.
 */

import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Fragment, useMemo, useRef } from 'react';
import { headingSlug, inlineText, type Inline, type MdNode } from '../../legal/markdown';
import { font, radii } from '../design/styles';
import { HAIRLINE, SURFACE_SECONDARY, TEXT_PRIMARY, TEXT_SECONDARY } from '../design/tokens';
import { useReadableWeight } from '../design/scale';
import { roleFont, roleWeight, TEXT_ROLES } from '../design/text-weight';
import { useScrollRow } from './use-scroll-row';

const PROSE = {
  body: {
    ...roleFont('body'),
    lineHeight: 1.75,
    color: TEXT_PRIMARY,
    fontFamily: font.family,
    margin: '0 0 12px',
  } satisfies CSSProperties,
  h1: {
    fontSize: TEXT_ROLES.lead.px,
    fontWeight: TEXT_ROLES.lead.weight,
    lineHeight: 1.3,
    color: TEXT_PRIMARY,
    fontFamily: font.family,
    margin: '0 0 12px',
  } satisfies CSSProperties,
  h2: {
    fontSize: TEXT_ROLES.head.px,
    fontWeight: TEXT_ROLES.head.weight,
    lineHeight: 1.3,
    color: TEXT_PRIMARY,
    fontFamily: font.family,
    margin: '24px 0 8px',
  } satisfies CSSProperties,
  h3: {
    fontSize: TEXT_ROLES.label.px,
    fontWeight: TEXT_ROLES.label.weight,
    lineHeight: 1.3,
    color: TEXT_PRIMARY,
    fontFamily: font.family,
    margin: '20px 0 6px',
  } satisfies CSSProperties,
  h4: {
    fontSize: TEXT_ROLES.subhead.px,
    fontWeight: TEXT_ROLES.subhead.weight,
    lineHeight: 1.3,
    color: TEXT_PRIMARY,
    fontFamily: font.family,
    margin: '16px 0 4px',
  } satisfies CSSProperties,
  link: {
    color: TEXT_PRIMARY,
    textDecoration: 'underline',
  } satisfies CSSProperties,
  code: {
    fontFamily: 'monospace',
    fontSize: TEXT_ROLES.chip.px,
    fontWeight: 400,
    background: SURFACE_SECONDARY,
    padding: '1px 4px',
    borderRadius: radii.sm,
  } satisfies CSSProperties,
  list: {
    margin: '0 0 12px',
    paddingLeft: 24,
  } satisfies CSSProperties,
  li: {
    marginBottom: 4,
  } satisfies CSSProperties,
  blockquote: {
    margin: '0 0 12px',
    paddingLeft: 12,
    borderLeft: `3px solid ${TEXT_SECONDARY}`,
    color: TEXT_SECONDARY,
  } satisfies CSSProperties,
  hr: {
    border: 'none',
    borderTop: `1px solid ${TEXT_SECONDARY}`,
    margin: '20px 0',
  } satisfies CSSProperties,
  tblWrap: {
    margin: '0 0 12px',
  } satisfies CSSProperties,
  table: {
    ...roleFont('body'),
    borderCollapse: 'collapse',
    width: '100%',
  } satisfies CSSProperties,
  th: {
    textAlign: 'left',
    padding: '6px 10px',
    borderBottom: `2px solid ${TEXT_SECONDARY}`,
    fontWeight: roleWeight('label'),
    color: TEXT_PRIMARY,
    fontFamily: font.family,
  } satisfies CSSProperties,
  td: {
    padding: '6px 10px',
    borderBottom: `1px solid ${HAIRLINE}`,
    color: TEXT_PRIMARY,
    fontFamily: font.family,
  } satisfies CSSProperties,
} as const;

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4';
type LinkNode = Extract<Inline, { t: 'link' }>;

/** How a Markdown tree is drawn: each element's style, and what a link becomes. */
export interface MarkdownLook {
  /** A heading level's tag and style; a surface whose own hierarchy the prose must not change
   *  draws every level as one tag. */
  heading(level: 1 | 2 | 3 | 4): { tag: HeadingTag; style: CSSProperties };
  /** A paragraph, and each line of a quote. */
  p: CSSProperties;
  list: CSSProperties;
  li?: CSSProperties;
  blockquote: CSSProperties;
  hr: CSSProperties;
  tableWrap: CSSProperties;
  table: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
  code: CSSProperties;
  /** Bold text outside a heading; inside one it takes the heading's weight. */
  strong: CSSProperties;
  /** Gives each heading the id its text slugs to, as the static pages do. */
  anchors?: boolean;
  link(node: LinkNode, key: number): ReactNode;
}

/** A markdown table's scroll wrapper, as its own component rather than a call inline in
 *  `block`: `block` is a plain function invoked once per node from a `.map()`, so a hook call
 *  there would run a variable number of times per render (once per table in the doc) and break the
 *  rules of hooks. A real component gives each mounted `<TableWrap>` its own hook call. */
function TableWrap({ zoom, style, children }: { zoom: number; style: CSSProperties; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const row = useScrollRow(ref, { zoom, pointerEvents: 'auto' });
  return (
    <div ref={ref} className="tbl" style={{ ...style, ...row }}>
      {children}
    </div>
  );
}

function inlineOne(node: Inline, key: number, look: MarkdownLook, strong: CSSProperties): ReactNode {
  switch (node.t) {
    case 'text':
      return node.text;
    case 'strong':
      return <strong key={key} style={strong}>{node.text}</strong>;
    case 'em':
      return <em key={key}>{node.text}</em>;
    case 'code':
      return <code key={key} style={look.code}>{node.text}</code>;
    case 'link':
      return look.link(node, key);
  }
}

/** One run of inline spans in `look`, each keyed `keyPrefix` and its index, so runs from several
 *  blocks can stand in one list. */
export function markdownInline(children: Inline[], look: MarkdownLook, keyPrefix = '', strong: CSSProperties = look.strong): ReactNode[] {
  return children.map((node, i) => <Fragment key={`${keyPrefix}${i}`}>{inlineOne(node, i, look, strong)}</Fragment>);
}

function block(node: MdNode, key: number, look: MarkdownLook, zoom: number): ReactNode {
  const inline = (children: Inline[]) => markdownInline(children, look);
  switch (node.t) {
    case 'h': {
      const { tag: Tag, style } = look.heading(node.level);
      const id = look.anchors ? headingSlug(inlineText(node.children)) : undefined;
      return (
        <Tag key={key} id={id} style={style}>
          {markdownInline(node.children, look, '', { ...look.strong, fontWeight: 'inherit' })}
        </Tag>
      );
    }
    case 'p':
      return <p key={key} style={look.p}>{inline(node.children)}</p>;
    case 'ul':
    case 'ol': {
      const List = node.t;
      return (
        <List key={key} style={look.list}>
          {node.items.map((item, i) => <li key={i} style={look.li}>{inline(item)}</li>)}
        </List>
      );
    }
    case 'blockquote':
      return (
        <blockquote key={key} style={look.blockquote}>
          {node.children.map((line, i) => <p key={i} style={look.p}>{inline(line)}</p>)}
        </blockquote>
      );
    case 'hr':
      return <hr key={key} style={look.hr} />;
    case 'table':
      return (
        <TableWrap key={key} zoom={zoom} style={look.tableWrap}>
          <table style={look.table}>
            <thead>
              <tr>
                {node.header.map((cell, i) => <th key={i} scope="col" style={look.th}>{inline(cell)}</th>)}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => <td key={ci} style={look.td}>{inline(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      );
  }
}

/** A tree's blocks drawn in `look`; `zoom` is the CSS zoom they stand under, which a wide table's
 *  wheel travel divides out. */
export function markdownBlocks(nodes: readonly MdNode[], look: MarkdownLook, zoom = 1): ReactNode[] {
  return nodes.map((node, i) => block(node, i, look, zoom));
}

/** Optional callback: when a root-relative internal link (`/privacy`, `/zh/terms`, …) is clicked,
 *  intercept the default full-page navigation and hand the slug path to the caller (the in-modal
 *  reader re-opens the target doc in place). Fragment links (`#anchor`) and external links are never
 *  intercepted. `undefined` (the static-page/default case) leaves links as plain navigations. */
type InternalLinkHandler = ((slugPath: string) => void) | undefined;

/** A legal link: inert text where the edition opens no outside page, a new tab for an external one,
 *  and an internal one handed to `onInternalLink` on a plain click (the `href` stays for
 *  open-in-new-tab and assistive technology). */
function legalLink(node: LinkNode, key: number, onInternalLink: InternalLinkHandler): ReactNode {
  if (!SUPPORTS_EXTERNAL_LINKS) return <span key={key}>{node.text}</span>;
  if (node.external) {
    return <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" style={PROSE.link}>{node.text}</a>;
  }
  const onClick = onInternalLink && node.href.startsWith('/')
    ? (e: ReactMouseEvent) => {
        // Modifier and middle clicks open a new tab.
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onInternalLink(node.href);
      }
    : undefined;
  return <a key={key} href={node.href} style={PROSE.link} onClick={onClick}>{node.text}</a>;
}

export function LegalMarkdown({
  nodes,
  onInternalLink,
  dense,
  zoom = 1,
}: {
  nodes: MdNode[];
  onInternalLink?: (slugPath: string) => void;
  dense?: boolean;
  /** The CSS zoom the prose is drawn under, which a wide table's wheel travel divides out. */
  zoom?: number;
}) {
  const weightAt = useReadableWeight(dense);
  const look = useMemo((): MarkdownLook => ({
    heading: (level) => {
      const tag = `h${level}` as const;
      return { tag, style: { ...PROSE[tag], fontWeight: weightAt(PROSE[tag].fontWeight, PROSE[tag].fontSize) } };
    },
    p: PROSE.body,
    list: { ...PROSE.body, ...PROSE.list },
    li: PROSE.li,
    blockquote: PROSE.blockquote,
    hr: PROSE.hr,
    tableWrap: PROSE.tblWrap,
    table: PROSE.table,
    th: PROSE.th,
    td: PROSE.td,
    code: PROSE.code,
    strong: { fontWeight: roleWeight('label') },
    anchors: true,
    link: (node, key) => legalLink(node, key, onInternalLink),
  }), [weightAt, onInternalLink]);
  return <>{markdownBlocks(nodes, look, zoom)}</>;
}
