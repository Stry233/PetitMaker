import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderHtml } from '../../legal/markdown-html';
import { LegalMarkdown } from '../../legal/LegalMarkdown';
import { parseLegalMarkdown } from '../../legal/markdown';
import type { MdNode } from '../../legal/markdown';

// The corpus: one source string exercising every grammar construct
// (headings 1-4, paragraphs, ul/ol, blockquote, hr, table, and every inline
// span incl. an external + an internal link) plus a hostile block appended
// to exercise escaping in headings/table cells/link text.
const CORPUS_SRC = `# Title One

## Section Two

### Sub Three

#### Detail Four

A paragraph with **bold**, *em*, \`code\`, and a [link](https://a.b/path).
Also an [internal link](/privacy) and a [fragment link](#s1).

- alpha
- beta

1. first
2. second

> a quoted line
> a second quoted line

---

| A | B | C |
| --- | --- | --- |
| 1 | 2 | 3 |
| 4 | 5 | 6 |
`;

const HOSTILE_SRC = `# "><img src=x onerror=alert(1)>

| "><img src=x onerror=alert(1)> | B |
| --- | --- |
| cell | "><img src=x onerror=alert(1)> |

A paragraph with a [hostile link text "><img src=x onerror=alert(1)>](https://a.b/"onmouseover=x) and a <script>alert(1)</script> raw tag.
`;

function extractStructure(root: ParentNode) {
  const tags: string[] = [];
  const hrefs: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === node.ELEMENT_NODE) {
      const el = node as Element;
      tags.push(el.tagName.toLowerCase());
      if (el.tagName === 'A') hrefs.push(el.getAttribute('href') ?? '');
    }
    node.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  const text = (root.textContent ?? '').replace(/\s+/g, ' ').trim();
  return { tags, hrefs, text };
}

function parseHtmlFragment(html: string): HTMLBodyElement {
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${html}</body></html>`, 'text/html');
  return doc.body as HTMLBodyElement;
}

describe('renderHtml — escaping', () => {
  it('escapes hostile text inside a heading', () => {
    const nodes = parseLegalMarkdown('# "><img src=x onerror=alert(1)>');
    const html = renderHtml(nodes);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('escapes hostile text inside table cells', () => {
    const nodes = parseLegalMarkdown('| "><img src=x onerror=alert(1)> | B |\n| --- | --- |\n| cell | val |');
    const html = renderHtml(nodes);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('escapes hostile text inside link text', () => {
    const nodes = parseLegalMarkdown('[hostile "><img src=x onerror=alert(1)>](https://a.b)');
    const html = renderHtml(nodes);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<img src=x');
  });

  it('attribute-escapes a hostile-but-allowed href (embedded quote)', () => {
    const nodes = parseLegalMarkdown('[x](https://a.b/"onmouseover=x)');
    const html = renderHtml(nodes);
    // the href attribute value must have its embedded '"' escaped so it
    // cannot break out of the attribute into a new (injected) attribute
    expect(html).toContain('href="https://a.b/&quot;onmouseover=x"');
    expect(html).not.toContain('href="https://a.b/"onmouseover=x"');
  });

  it('a raw-HTML-looking paragraph renders as escaped literal text, not a real tag', () => {
    const nodes = parseLegalMarkdown('<script>alert(1)</script>');
    const html = renderHtml(nodes);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('renderHtml — structure', () => {
  const nodes = parseLegalMarkdown(CORPUS_SRC);
  const html = renderHtml(nodes);

  it('emits scope="col" on table header cells', () => {
    expect(html).toContain('<th scope="col">');
  });

  it('wraps the table in a <div class="tbl"> wide-table wrapper', () => {
    expect(html).toMatch(/<div class="tbl">\s*<table>/);
  });

  it('emits target="_blank" rel="noopener noreferrer" on the external https link', () => {
    expect(html).toContain('<a href="https://a.b/path" target="_blank" rel="noopener noreferrer">link</a>');
  });

  it('emits no target/rel attribute on the internal relative link', () => {
    expect(html).toContain('<a href="/privacy">internal link</a>');
  });

  it('emits no target/rel attribute on the internal fragment link', () => {
    expect(html).toContain('<a href="#s1">fragment link</a>');
  });

  it('preserves heading hierarchy: h1 down to h4', () => {
    expect(html).toContain('<h1 id="title-one">Title One</h1>');
    expect(html).toContain('<h2 id="section-two">Section Two</h2>');
    expect(html).toContain('<h3 id="sub-three">Sub Three</h3>');
    expect(html).toContain('<h4 id="detail-four">Detail Four</h4>');
  });
});

describe('structural parity — renderHtml vs <LegalMarkdown/>', () => {
  function expectParity(nodes: MdNode[]) {
    const html = renderHtml(nodes);
    const htmlStruct = extractStructure(parseHtmlFragment(html));

    const { container } = render(LegalMarkdown({ nodes }));
    const reactStruct = extractStructure(container);

    expect(reactStruct).toEqual(htmlStruct);
  }

  it('matches for the full grammar corpus', () => {
    expectParity(parseLegalMarkdown(CORPUS_SRC));
  });

  it('matches for a hostile-content corpus (headings/table cells/link text/attrs)', () => {
    expectParity(parseLegalMarkdown(HOSTILE_SRC));
  });

  it('matches for an empty node list', () => {
    expectParity([]);
  });
});

describe('<LegalMarkdown/> — React-side link and table attributes', () => {
  it('renders external link with target="_blank" and rel="noopener noreferrer"', () => {
    const nodes = parseLegalMarkdown('[x](https://a.b/path)');
    const { container } = render(LegalMarkdown({ nodes }));
    const a = container.querySelector('a[href="https://a.b/path"]');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders internal link with no target and no rel attribute', () => {
    const nodes = parseLegalMarkdown('[y](/privacy)');
    const { container } = render(LegalMarkdown({ nodes }));
    const a = container.querySelector('a[href="/privacy"]');
    expect(a?.getAttribute('target')).toBeNull();
    expect(a?.getAttribute('rel')).toBeNull();
  });

  it('renders table header cells with scope="col"', () => {
    const nodes = parseLegalMarkdown('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
    const { container } = render(LegalMarkdown({ nodes }));
    const th = container.querySelector('th');
    expect(th?.getAttribute('scope')).toBe('col');
  });
});
