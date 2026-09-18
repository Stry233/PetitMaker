import { SUPPORTS_EXTERNAL_LINKS } from '../core/runtime/edition';
/**
 * React emitter for the constrained legal-markdown node tree
 * (`src/legal/markdown.ts`) — the in-app modal counterpart to the static
 * HTML serializer (`markdown-html.ts`). Same source tree, same DOM shape
 * (structural parity is unit-tested), styled inline from the `PROSE` map
 * below (espresso-on-cream tokens from `src/ui/design/styles.ts`, no invented
 * colors). Renders NO wrapping element at the root (a `Fragment`) so its
 * DOM output matches `renderHtml`'s unwrapped block sequence exactly.
 *
 * SECURITY: React escapes all text/attribute values by default, so nothing
 * here may use `dangerouslySetInnerHTML`.
 */

import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { Fragment, useRef } from 'react';
import { headingSlug, inlineText, type Inline, type MdNode } from './markdown';
import { colors, font } from '../ui/design/styles';
import { useReadableWeight } from '../ui/design/scale';
import { roleFont, roleWeight } from '../ui/design/text-weight';
import { useScrollFade } from '../ui/primitives/scroll-fade';

const PROSE = {
  body: {
    ...roleFont('body'),
    lineHeight: 1.75,
    color: colors.textPrimary,
    fontFamily: font.family,
    margin: '0 0 12px',
  } satisfies CSSProperties,
  h1: {
    fontSize: 20,
    fontWeight: 800,
    lineHeight: 1.3,
    color: colors.textPrimary,
    fontFamily: font.family,
    margin: '0 0 12px',
  } satisfies CSSProperties,
  h2: {
    fontSize: 17,
    fontWeight: 800,
    lineHeight: 1.3,
    color: colors.textPrimary,
    fontFamily: font.family,
    margin: '24px 0 8px',
  } satisfies CSSProperties,
  h3: {
    fontSize: 15,
    fontWeight: 700,
    lineHeight: 1.3,
    color: colors.textPrimary,
    fontFamily: font.family,
    margin: '20px 0 6px',
  } satisfies CSSProperties,
  h4: {
    fontSize: 13,
    fontWeight: 700,
    lineHeight: 1.3,
    color: colors.textPrimary,
    fontFamily: font.family,
    margin: '16px 0 4px',
  } satisfies CSSProperties,
  link: {
    color: colors.textPrimary,
    textDecoration: 'underline',
  } satisfies CSSProperties,
  code: {
    fontFamily: 'monospace',
    fontSize: '0.92em',
    fontWeight: 400,
    background: colors.surfaceSecondary,
    padding: '1px 4px',
    borderRadius: 4,
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
    borderLeft: `3px solid ${colors.textSecondary}`,
    color: colors.textSecondary,
  } satisfies CSSProperties,
  hr: {
    border: 'none',
    borderTop: `1px solid ${colors.textSecondary}`,
    margin: '20px 0',
  } satisfies CSSProperties,
  tblWrap: {
    overflowX: 'auto',
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
    borderBottom: `2px solid ${colors.textSecondary}`,
    fontWeight: roleWeight('label'),
    color: colors.textPrimary,
    fontFamily: font.family,
  } satisfies CSSProperties,
  td: {
    padding: '6px 10px',
    borderBottom: `1px solid ${colors.inkBorder}`,
    color: colors.textPrimary,
    fontFamily: font.family,
  } satisfies CSSProperties,
} as const;

/** Optional callback: when a root-relative INTERNAL link (`/privacy`,
 *  `/zh/terms`, …) is clicked, intercept the default full-page navigation and
 *  hand the slug path to the caller (the in-modal reader re-opens the target
 *  doc in place). Fragment links (`#anchor`) and external links are never
 *  intercepted. `undefined` (the static-page/default case) leaves links as
 *  plain navigations. */
type InternalLinkHandler = ((slugPath: string) => void) | undefined;

/** A markdown table's scroll wrapper, as its own component rather than a call inline in
 *  `renderBlock`: `renderBlock` is a plain function invoked once per node from a `.map()`, so a
 *  hook call there would run a variable number of times per `LegalMarkdown` render (once per table
 *  in the doc) and break the rules of hooks. A real component sidesteps that — React gives each
 *  mounted `<TableWrap>` its own hook call, however many a doc holds. */
function TableWrap({ children }: { children: ReactNode }): ReactNode {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(ref, 'x');
  return (
    <div ref={ref} className="tbl" style={{ ...PROSE.tblWrap, ...fade }}>
      {children}
    </div>
  );
}

function renderInlineOne(node: Inline, key: number, onInternalLink: InternalLinkHandler, strongWeight: CSSProperties['fontWeight']): ReactNode {
  switch (node.t) {
    case 'text':
      return node.text;
    case 'strong':
      return <strong key={key} style={{ fontWeight: strongWeight }}>{node.text}</strong>;
    case 'em':
      return <em key={key}>{node.text}</em>;
    case 'code':
      return (
        <code key={key} style={PROSE.code}>
          {node.text}
        </code>
      );
    case 'link': {
      if (!SUPPORTS_EXTERNAL_LINKS) return <span key={key}>{node.text}</span>;
      if (node.external) {
        return (
          <a key={key} href={node.href} target="_blank" rel="noopener noreferrer" style={PROSE.link}>
            {node.text}
          </a>
        );
      }
      // Internal link. When a handler is supplied and this is a root-relative
      // path (not a pure `#fragment` in-page anchor), intercept the click so the
      // in-modal reader switches docs instead of full-page navigating out of the
      // SPA. The `href` stays set for right-click/open-in-new-tab + a11y.
      const isSlugPath = node.href.startsWith('/');
      const onClick =
        onInternalLink && isSlugPath
          ? (e: ReactMouseEvent) => {
              // Respect modifier-click / middle-click (open in new tab).
              if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              onInternalLink(node.href);
            }
          : undefined;
      return (
        <a key={key} href={node.href} style={PROSE.link} onClick={onClick}>
          {node.text}
        </a>
      );
    }
  }
}

function renderInline(children: Inline[], onInternalLink: InternalLinkHandler, strongWeight: CSSProperties['fontWeight'] = roleWeight('label')): ReactNode {
  return children.map((node, i) => (
    <Fragment key={i}>{renderInlineOne(node, i, onInternalLink, strongWeight)}</Fragment>
  ));
}

function renderBlock(node: MdNode, key: number, onInternalLink: InternalLinkHandler, weightAt: (nominal: number, size: number) => number): ReactNode {
  switch (node.t) {
    case 'h': {
      const Tag = `h${node.level}` as 'h1' | 'h2' | 'h3' | 'h4';
      const id = headingSlug(inlineText(node.children));
      return (
        <Tag key={key} id={id} style={{ ...PROSE[Tag], fontWeight: weightAt(PROSE[Tag].fontWeight, PROSE[Tag].fontSize) }}>
          {renderInline(node.children, onInternalLink, 'inherit')}
        </Tag>
      );
    }
    case 'p':
      return (
        <p key={key} style={PROSE.body}>
          {renderInline(node.children, onInternalLink)}
        </p>
      );
    case 'ul':
      return (
        <ul key={key} style={{ ...PROSE.body, ...PROSE.list }}>
          {node.items.map((item, i) => (
            <li key={i} style={PROSE.li}>
              {renderInline(item, onInternalLink)}
            </li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} style={{ ...PROSE.body, ...PROSE.list }}>
          {node.items.map((item, i) => (
            <li key={i} style={PROSE.li}>
              {renderInline(item, onInternalLink)}
            </li>
          ))}
        </ol>
      );
    case 'blockquote':
      return (
        <blockquote key={key} style={PROSE.blockquote}>
          {node.children.map((line, i) => (
            <p key={i} style={PROSE.body}>
              {renderInline(line, onInternalLink)}
            </p>
          ))}
        </blockquote>
      );
    case 'hr':
      return <hr key={key} style={PROSE.hr} />;
    case 'table':
      return (
        <TableWrap key={key}>
          <table style={PROSE.table}>
            <thead>
              <tr>
                {node.header.map((cell, i) => (
                  <th key={i} scope="col" style={PROSE.th}>
                    {renderInline(cell, onInternalLink)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} style={PROSE.td}>
                      {renderInline(cell, onInternalLink)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      );
  }
}

export function LegalMarkdown({
  nodes,
  onInternalLink,
  dense,
}: {
  nodes: MdNode[];
  onInternalLink?: (slugPath: string) => void;
  dense?: boolean;
}) {
  const weightAt = useReadableWeight(dense);
  return <>{nodes.map((node, i) => renderBlock(node, i, onInternalLink, weightAt))}</>;
}
