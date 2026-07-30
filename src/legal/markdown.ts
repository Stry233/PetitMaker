/**
 * A constrained, whitelist markdown parser for the legal docs (privacy,
 * terms, about, contact, …). Pure — no React, no DOM, no imports from
 * `./config`. Shared by three render surfaces (in-app modal, static pages,
 * GitHub root files render the raw source directly) so it must be a strict
 * subset with no ambiguity: no raw HTML, no nested inline spans, and a
 * hard-denylist href sanitizer.
 */

export type Inline =
  | { t: 'text' | 'strong' | 'em' | 'code'; text: string }
  | { t: 'link'; text: string; href: string; external: boolean };

export type MdNode =
  | { t: 'h'; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { t: 'p'; children: Inline[] }
  | { t: 'ul' | 'ol'; items: Inline[][] }
  | { t: 'blockquote'; children: Inline[][] }
  | { t: 'hr' }
  | { t: 'table'; header: Inline[][]; rows: Inline[][][] };

/** Concatenates the plain text of an inline-node list (every `Inline` variant
 * carries a `text` field, including `link` — the link's visible text, not its
 * href). Shared by both emitters to compute a heading's id from the same
 * source `headingSlug` uses. */
export function inlineText(children: Inline[]): string {
  return children.map((c) => c.text).join('');
}

// GitHub's heading-anchor algorithm (the one the docs' in-doc `[text](#slug)`
// links assume): lowercase, drop everything except letters (incl. CJK —
// `\p{L}` is script-agnostic), digits, spaces, and hyphens, then turn each
// space into a hyphen (one-for-one — two adjacent stripped punctuation chars
// separated by a space, e.g. "Data & \"Clear" -> "data  clear", yields a
// double hyphen "data--clear", matching GitHub exactly). No HTML escaping
// here: a caller emitting this into an `id="..."` attribute must still run it
// through its own attribute escaper.
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-');
}

const ALLOWED_SCHEMES = ['https:', 'mailto:'];
const BANNED_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:'];

const stripControlChars = (s: string): string => s.replace(/[\x00-\x1F\x7F]/g, '');

// Decodes exactly one `%XX` pass plus decimal/hex numeric HTML entities
// (`&#106;` / `&#x6A;`) — the two encodings attackers use to smuggle a
// `javascript:`-family scheme past a naive literal-prefix check (e.g.
// `&#106;avascript:` or `%6A%61vascript:`). We only need this to *detect* a
// disguised banned scheme, never to alter what gets rendered.
function decodeForSchemeCheck(s: string): string {
  let decoded = s;
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // malformed percent-encoding: fall through and entity-decode as-is
  }
  decoded = decoded
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  return stripControlChars(decoded);
}

/**
 * Trim, strip ASCII control chars, and check the href against a scheme
 * allowlist — rejecting anything (including its decoded form) that resolves
 * to a banned scheme. Returns `null` on any rejection; the caller renders
 * the link text as plain text with no href. When in doubt, reject.
 */
export function sanitizeHref(raw: string): { href: string; external: boolean } | null {
  const s = stripControlChars(raw.trim());
  if (s.length === 0) return null;

  const lower = s.toLowerCase();
  if (BANNED_SCHEMES.some((scheme) => lower.startsWith(scheme))) return null;

  const decoded = decodeForSchemeCheck(lower);
  if (BANNED_SCHEMES.some((scheme) => decoded.startsWith(scheme))) return null;

  if (ALLOWED_SCHEMES.some((scheme) => lower.startsWith(scheme))) {
    return { href: s, external: true };
  }

  // Scheme-less relative paths only: '#fragment' or '/root-relative'.
  // '//host' (protocol-relative) is explicitly rejected — it resolves to an
  // arbitrary origin under the current scheme. A backslash ANYWHERE, or a
  // '/' immediately followed by '/' or '\', is also rejected: browsers
  // normalize both '/\host' and '/\/host' to '//host' (protocol-relative),
  // so a naive check admitting those is an open-redirect bypass.
  if (s.includes('\\')) return null;
  if (/^\/[\\/]/.test(s)) return null;
  if (s.startsWith('#')) return { href: s, external: false };
  if (s.startsWith('/')) return { href: s, external: false };

  return null;
}

// Single-pass inline tokenizer. No nesting: once a span's delimiters match,
// its inner text is taken verbatim (never re-scanned), so malformed nesting
// like "**a *b** c*" just leaves stray '*' runs as literal text instead of
// throwing or mis-parsing. The link destination allows ONE level of balanced
// parens (`(?:[^()]|\([^()]*\))*`) so hrefs like a Wikipedia disambiguation
// link — or an attacker's `javascript:alert(1)` — capture whole, not
// truncated at the first inner ')'.
const INLINE_RE =
  /\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)|\*\*([^*]+?)\*\*|`([^`]+?)`|\*([^*]+?)\*/g;

function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let lastIndex = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > lastIndex) out.push({ t: 'text', text: text.slice(lastIndex, m.index) });

    if (m[1] !== undefined) {
      const sanitized = sanitizeHref(m[2] ?? '');
      out.push(
        sanitized
          ? { t: 'link', text: m[1], href: sanitized.href, external: sanitized.external }
          : { t: 'text', text: m[1] },
      );
    } else if (m[3] !== undefined) {
      out.push({ t: 'strong', text: m[3] });
    } else if (m[4] !== undefined) {
      out.push({ t: 'code', text: m[4] });
    } else if (m[5] !== undefined) {
      out.push({ t: 'em', text: m[5] });
    }
    lastIndex = INLINE_RE.lastIndex;
  }
  if (lastIndex < text.length) out.push({ t: 'text', text: text.slice(lastIndex) });
  if (out.length === 0) out.push({ t: 'text', text: '' });
  return out;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  const cells = trimmed
    .split('|')
    .map((c) => c.trim())
    .filter((c) => c !== '');
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

function padOrTruncate(cells: string[], width: number): string[] {
  const out = cells.slice(0, width);
  while (out.length < width) out.push('');
  return out;
}

// Does this line (given what follows) start a NEW structural block, rather
// than continue the paragraph currently being accumulated?
function isBlockStart(line: string, next: string | undefined): boolean {
  if (line.trim() === '') return true;
  if (/^-{3,}$/.test(line.trim())) return true;
  if (/^#{1,4}\s+/.test(line)) return true;
  if (/^[-*]\s+/.test(line)) return true;
  if (/^\d+\.\s+/.test(line)) return true;
  if (/^>/.test(line)) return true;
  if (line.includes('|') && next !== undefined && isTableSeparator(next)) return true;
  return false;
}

/**
 * Line-based block scanner. Grammar (whitelist): `#`-`####` headings,
 * `-`/`*` ul, `1.` ol, `>` blockquote, standalone `---` hr, `|`-tables
 * (header row + `---` separator row), everything else is a paragraph
 * (blank-line separated, consecutive lines joined with a space).
 */
export function parseLegalMarkdown(src: string): MdNode[] {
  const lines = src.split(/\r?\n/);
  const nodes: MdNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const next = lines[i + 1];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (/^-{3,}$/.test(line.trim())) {
      nodes.push({ t: 'hr' });
      i++;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      nodes.push({
        t: 'h',
        level: heading[1]!.length as 1 | 2 | 3 | 4,
        children: parseInline(heading[2]!),
      });
      i++;
      continue;
    }

    if (line.includes('|') && next !== undefined && isTableSeparator(next)) {
      const header = splitTableRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) {
        rows.push(padOrTruncate(splitTableRow(lines[i]!), header.length).map(parseInline));
        i++;
      }
      nodes.push({ t: 'table', header, rows });
      continue;
    }

    if (/^>/.test(line)) {
      const children: Inline[][] = [];
      while (i < lines.length && /^>/.test(lines[i]!)) {
        children.push(parseInline(lines[i]!.replace(/^>\s?/, '')));
        i++;
      }
      nodes.push({ t: 'blockquote', children });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!)) {
        let text = lines[i]!.replace(/^[-*]\s+/, '');
        i++;
        // Lazy continuation: an indented (2+ spaces), non-blank line right
        // after an item is the same item's hard-wrap, not a new block — join
        // it with a single space before inline parsing. A blank line or any
        // new construct (checked by the loop condition above) still ends the
        // list as usual.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!)) {
          text += ' ' + lines[i]!.trim();
          i++;
        }
        items.push(parseInline(text));
      }
      nodes.push({ t: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!)) {
        let text = lines[i]!.replace(/^\d+\.\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]!)) {
          text += ' ' + lines[i]!.trim();
          i++;
        }
        items.push(parseInline(text));
      }
      nodes.push({ t: 'ol', items });
      continue;
    }

    const paraLines: string[] = [];
    while (i < lines.length && !isBlockStart(lines[i]!, lines[i + 1])) {
      paraLines.push(lines[i]!);
      i++;
    }
    nodes.push({ t: 'p', children: parseInline(paraLines.join(' ')) });
  }

  return nodes;
}
