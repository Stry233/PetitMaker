/**
 * Static HTML serializer for the constrained legal-markdown node tree
 * (`src/legal/markdown.ts`). Pure, no DOM/React — shared by the static-page
 * build (`scripts/build-legal-pages.mts`) and directly tested here
 * for structural parity against the React emitter (`LegalMarkdown.tsx`).
 *
 * SECURITY: `parseLegalMarkdown` deliberately does NOT escape text or hrefs
 * (see markdown.ts doc comment) — this is the one place that must. Every
 * text node and every attribute value flows through the single `esc()`
 * below; there is no other path that writes into the output string.
 */

import { headingSlug, inlineText, type Inline, type MdNode } from './markdown';

// One escaper for both text content and attribute values: a single
// security-reviewed path rather than two that could drift.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInlineOne(node: Inline): string {
  switch (node.t) {
    case 'text':
      return esc(node.text);
    case 'strong':
      return `<strong>${esc(node.text)}</strong>`;
    case 'em':
      return `<em>${esc(node.text)}</em>`;
    case 'code':
      return `<code>${esc(node.text)}</code>`;
    case 'link': {
      // On an external link: noopener blocks window.opener reverse-tabnabbing
      // and noreferrer drops the referrer. Internal (relative/fragment) links
      // open in place and get neither.
      const rel = node.external ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${esc(node.href)}"${rel}>${esc(node.text)}</a>`;
    }
  }
}

function renderInline(children: Inline[]): string {
  return children.map(renderInlineOne).join('');
}

function renderBlock(node: MdNode): string {
  switch (node.t) {
    case 'h': {
      const id = headingSlug(inlineText(node.children));
      return `<h${node.level} id="${esc(id)}">${renderInline(node.children)}</h${node.level}>`;
    }
    case 'p':
      return `<p>${renderInline(node.children)}</p>`;
    case 'ul':
      return `<ul>${node.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ul>`;
    case 'ol':
      return `<ol>${node.items.map((item) => `<li>${renderInline(item)}</li>`).join('')}</ol>`;
    case 'blockquote':
      return `<blockquote>${node.children.map((line) => `<p>${renderInline(line)}</p>`).join('')}</blockquote>`;
    case 'hr':
      return '<hr />';
    case 'table': {
      const thead = `<thead><tr>${node.header
        .map((cell) => `<th scope="col">${renderInline(cell)}</th>`)
        .join('')}</tr></thead>`;
      const tbody = `<tbody>${node.rows
        .map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      // Wide tables (many legal docs carry retention/rights tables) get their
      // own horizontally-scrollable box (`.tbl`) rather than blowing out the
      // page — the page itself must never gain horizontal scroll.
      return `<div class="tbl"><table>${thead}${tbody}</table></div>`;
    }
  }
}

/** Renders a node tree to a static HTML string (no wrapping element — the
 * caller supplies the page/section shell). Escapes all text and attribute
 * values; see `esc()` above. */
export function renderHtml(nodes: MdNode[]): string {
  return nodes.map(renderBlock).join('');
}
