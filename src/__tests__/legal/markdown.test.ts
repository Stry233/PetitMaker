import { describe, it, expect } from 'vitest';
import { parseLegalMarkdown, sanitizeHref, headingSlug, inlineText } from '../../legal/markdown';
import type { Inline } from '../../legal/markdown';

// Shorthand builders keep the expected-tree literals in the assertions below
// readable — this file is deliberately full of exact node-tree objects.
const txt = (text: string): Inline => ({ t: 'text', text });

describe('parseLegalMarkdown — headings', () => {
  it('parses levels 1-4', () => {
    const src = '# One\n\n## Two\n\n### Three\n\n#### Four';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'h', level: 1, children: [txt('One')] },
      { t: 'h', level: 2, children: [txt('Two')] },
      { t: 'h', level: 3, children: [txt('Three')] },
      { t: 'h', level: 4, children: [txt('Four')] },
    ]);
  });
});

describe('parseLegalMarkdown — paragraphs', () => {
  it('joins consecutive plain lines into one paragraph, blank line separates', () => {
    const src = 'Line one\nLine two\n\nSecond para';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'p', children: [txt('Line one Line two')] },
      { t: 'p', children: [txt('Second para')] },
    ]);
  });

  it('parses a raw-HTML-looking line as verbatim paragraph text (no HTML parsing)', () => {
    const src = '<script>alert(1)</script>';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'p', children: [txt('<script>alert(1)</script>')] },
    ]);
  });
});

describe('parseLegalMarkdown — lists', () => {
  it('parses a ul (- marker)', () => {
    const src = '- alpha\n- beta';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'ul', items: [[txt('alpha')], [txt('beta')]] },
    ]);
  });

  it('parses a ul (* marker)', () => {
    const src = '* alpha\n* beta';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'ul', items: [[txt('alpha')], [txt('beta')]] },
    ]);
  });

  it('parses an ol', () => {
    const src = '1. first\n2. second';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'ol', items: [[txt('first')], [txt('second')]] },
    ]);
  });

  it('joins a hard-wrapped bullet lazy-continuation line into ONE item (ul)', () => {
    const src = '- We show no advertising, use no advertising cookies, and do no cross-site or\n  cross-device tracking.\n- Second item.';
    expect(parseLegalMarkdown(src)).toEqual([
      {
        t: 'ul',
        items: [
          [txt('We show no advertising, use no advertising cookies, and do no cross-site or cross-device tracking.')],
          [txt('Second item.')],
        ],
      },
    ]);
  });

  it('joins MULTIPLE consecutive lazy-continuation lines into one item', () => {
    const src = '- alpha\n  beta\n  gamma\n- delta';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'ul', items: [[txt('alpha beta gamma')], [txt('delta')]] },
    ]);
  });

  it('a blank line still terminates the list (no join across it)', () => {
    const src = '- alpha\n\n  not a continuation, separate paragraph';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'ul', items: [[txt('alpha')]] },
      { t: 'p', children: [txt('  not a continuation, separate paragraph')] },
    ]);
  });

  it('joins a hard-wrapped ol item the same way', () => {
    const src = '1. first line continues onto\n   a second, indented line\n2. second';
    expect(parseLegalMarkdown(src)).toEqual([
      {
        t: 'ol',
        items: [[txt('first line continues onto a second, indented line')], [txt('second')]],
      },
    ]);
  });

  it('an indented line NOT preceded by a list item stays an ordinary paragraph', () => {
    const src = 'Above a plain paragraph\n  still indented but no list before it';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'p', children: [txt('Above a plain paragraph   still indented but no list before it')] },
    ]);
  });

  it('other block constructs immediately after a list are unaffected (heading not swallowed)', () => {
    const src = '- alpha\n\n## Heading';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'ul', items: [[txt('alpha')]] },
      { t: 'h', level: 2, children: [txt('Heading')] },
    ]);
  });

  it('a table immediately after a list is unaffected by lazy-continuation join', () => {
    const src = '- alpha\n\n| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'ul', items: [[txt('alpha')]] },
      {
        t: 'table',
        header: [[txt('A')], [txt('B')]],
        rows: [[[txt('1')], [txt('2')]]],
      },
    ]);
  });
});

describe('parseLegalMarkdown — blockquote', () => {
  it('groups consecutive > lines into one blockquote', () => {
    const src = '> line one\n> line two';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'blockquote', children: [[txt('line one')], [txt('line two')]] },
    ]);
  });
});

describe('parseLegalMarkdown — hr', () => {
  it('parses a standalone --- as hr', () => {
    const src = 'Above\n\n---\n\nBelow';
    expect(parseLegalMarkdown(src)).toEqual([
      { t: 'p', children: [txt('Above')] },
      { t: 'hr' },
      { t: 'p', children: [txt('Below')] },
    ]);
  });
});

describe('parseLegalMarkdown — table', () => {
  it('parses header + separator + rows, padding/truncating to header width', () => {
    const src = '| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |\n| 3 | 4 | 5 | 6 |';
    expect(parseLegalMarkdown(src)).toEqual([
      {
        t: 'table',
        header: [[txt('A')], [txt('B')], [txt('C')]],
        rows: [
          [[txt('1')], [txt('2')], [txt('')]],
          [[txt('3')], [txt('4')], [txt('5')]],
        ],
      },
    ]);
  });
});

describe('parseLegalMarkdown — inline spans', () => {
  it('parses strong, em, code, and link within a paragraph', () => {
    const src = 'a **bold** b *em* c `code` d [text](https://a.b) e';
    expect(parseLegalMarkdown(src)).toEqual([
      {
        t: 'p',
        children: [
          txt('a '),
          { t: 'strong', text: 'bold' },
          txt(' b '),
          { t: 'em', text: 'em' },
          txt(' c '),
          { t: 'code', text: 'code' },
          txt(' d '),
          { t: 'link', text: 'text', href: 'https://a.b', external: true },
          txt(' e'),
        ],
      },
    ]);
  });

  it('degrades malformed nesting ("**a *b** c*") to text without throwing', () => {
    // No nesting inside inline spans (grammar rule): the em delimiter class
    // ([^*]) can never bridge across a literal '*', so "**" here can't close
    // a strong span past the intervening single '*'s — it falls back to two
    // small em matches plus literal '*'/'b*' text runs. The important
    // invariant under test is that this never throws and every character is
    // accounted for (no silent truncation), not that it round-trips to a
    // single strong node.
    expect(() => parseLegalMarkdown('**a *b** c*')).not.toThrow();
    expect(parseLegalMarkdown('**a *b** c*')).toEqual([
      {
        t: 'p',
        children: [txt('*'), { t: 'em', text: 'a ' }, txt('b*'), { t: 'em', text: ' c' }],
      },
    ]);
  });

  it('renders link text as plain text (no link) when sanitizeHref rejects the href', () => {
    const src = '[x](javascript:alert(1))';
    expect(parseLegalMarkdown(src)).toEqual([{ t: 'p', children: [txt('x')] }]);
  });

  it('marks a relative path link as internal (external: false)', () => {
    expect(parseLegalMarkdown('[x](/privacy)')).toEqual([
      { t: 'p', children: [{ t: 'link', text: 'x', href: '/privacy', external: false }] },
    ]);
  });

  it('marks a fragment link as internal (external: false)', () => {
    expect(parseLegalMarkdown('[x](#s1)')).toEqual([
      { t: 'p', children: [{ t: 'link', text: 'x', href: '#s1', external: false }] },
    ]);
  });
});

describe('sanitizeHref — allowed', () => {
  it('allows https: and marks external', () => {
    expect(sanitizeHref('https://a.b')).toEqual({ href: 'https://a.b', external: true });
  });

  it('allows mailto: and marks external', () => {
    expect(sanitizeHref('mailto:x@example.com')).toEqual({
      href: 'mailto:x@example.com',
      external: true,
    });
  });

  it('allows a root-relative path and marks internal', () => {
    expect(sanitizeHref('/privacy')).toEqual({ href: '/privacy', external: false });
  });

  it('allows a fragment and marks internal', () => {
    expect(sanitizeHref('#s1')).toEqual({ href: '#s1', external: false });
  });
});

// headingSlug implements the GitHub anchor algorithm the docs' authors
// assumed when they wrote hrefs like [Share Images](#share-images) — these
// cases are lifted verbatim from the actual privacy.en/zh hrefs (see
// src/legal/content/privacy.{en,zh}.md) so a regression here is a dead-anchor bug.
describe('headingSlug', () => {
  it('lowercases and hyphenates a simple heading', () => {
    expect(headingSlug('Share Images')).toBe('share-images');
    expect(headingSlug('API Keys')).toBe('api-keys');
  });

  it('drops "&" without a replacement space, yielding a double hyphen', () => {
    expect(headingSlug('Analytics & Consent')).toBe('analytics--consent');
  });

  it('drops parens without a replacement space', () => {
    expect(headingSlug('AI Providers (BYOK)')).toBe('ai-providers-byok');
  });

  it('drops straight quotes without a replacement space (double hyphen at the "&" gap)', () => {
    expect(headingSlug('Local Data & "Clear Local Data"')).toBe('local-data--clear-local-data');
  });

  it('keeps CJK characters and only hyphenates actual ASCII spaces', () => {
    expect(headingSlug('API 密钥')).toBe('api-密钥');
    expect(headingSlug('分享图片')).toBe('分享图片');
    expect(headingSlug('AI 服务提供商（自带密钥）')).toBe('ai-服务提供商自带密钥');
    expect(headingSlug('本地数据与"清除本地数据"')).toBe('本地数据与清除本地数据');
  });
});

describe('inlineText', () => {
  it('concatenates plain text across every Inline variant, including link text', () => {
    const children: Inline[] = [
      { t: 'text', text: 'a ' },
      { t: 'strong', text: 'b' },
      { t: 'link', text: 'c', href: '/x', external: false },
    ];
    expect(inlineText(children)).toBe('a bc');
  });
});

describe('sanitizeHref — rejected', () => {
  it.each([
    ['javascript:alert(1)', 'literal javascript: scheme'],
    ['JaVaScRiPt:1', 'mixed-case javascript: scheme'],
    ['java\tscript:1', 'tab-split scheme (control-char strip re-forms it)'],
    ['&#106;avascript:1', 'decimal numeric-entity encoded scheme'],
    ['%6A%61vascript:1', 'percent-encoded scheme'],
    ['data:text/html,x', 'data: scheme'],
    ['//evil.com', 'protocol-relative URL'],
    ['/\\evil.com', 'backslash-slash root path (browser-normalizes to //evil.com)'],
    ['/\\/evil.com', 'slash-backslash-slash root path (browser-normalizes to //evil.com)'],
    ['\\/evil.com', 'leading backslash-slash (browser-normalizes to /evil.com or worse)'],
    ['jAvAsCrIpT&#58;alert(1)', 'mixed-case scheme with HTML entity-encoded colon'],
  ])('rejects %j (%s)', (raw) => {
    expect(sanitizeHref(raw)).toBeNull();
  });

  it('rejects an unknown absolute scheme', () => {
    expect(sanitizeHref('ftp://x')).toBeNull();
  });

  it('still allows a plain relative path and a fragment as internal', () => {
    expect(sanitizeHref('/privacy')).toEqual({ href: '/privacy', external: false });
    expect(sanitizeHref('#section')).toEqual({ href: '#section', external: false });
  });
});
