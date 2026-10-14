/**
 * Comments state facts in plain sentences, one precise line where one will do. Each check below
 * counts the comments that break that rule in a way a reader can see: emphasis written in
 * capitals, a capital in mid-sentence (`not A texture`, `the ramp'S own`, `the cell Already was`), work-item ids, measurement
 * anecdotes, blocks longer than a fact needs, JSDoc attached to nothing, and a header that opens with
 * its own file's name. No file holds one.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { comments } from '../_support/comments';
import { repoFiles } from '../_support/source-graph';
import { publicScriptFiles } from '../_support/public-tree';

// Parses every public source file through the compiler API.
vi.setConfig({ testTimeout: 60_000 });

type Check = 'caps' | 'midCapital' | 'workItem' | 'measurement' | 'longBlock' | 'detachedDoc' | 'selfNaming';
const CHECKS: readonly Check[] = ['caps', 'midCapital', 'workItem', 'measurement', 'longBlock', 'detachedDoc', 'selfNaming'];
/** What each check asks of a comment it finds. */
const FIX: Record<Check, string> = {
  caps: 'Emphasis written as a run of capitals; rewrite it as a plain sentence.',
  midCapital: 'A capital inside a sentence, left from emphasis written in capitals; write the word in lower case.',
  workItem: 'A task or lane id; state the fact without the work item.',
  measurement: 'A measurement anecdote with its run numbers; keep the rule in the code and the evidence in the private records.',
  longBlock: 'A comment longer than its fact needs (a header over 20 lines, any other block over 12); cut it to the invariant.',
  detachedDoc: 'A JSDoc block attached to no declaration; fold it into the declaration it describes or delete it.',
  selfNaming: 'The header opens with its own file name; open with what the file holds.',
};

const walk = (dir: string): string[] => repoFiles(dir, { accept: /\.[cm]?[jt]sx?$/ });

/** Internal files are withheld from the public tree, so only the name check reads them. Outside
 *  `src/` and `security/` only what the snapshot ships is read. */
const ALL = [...walk('src'), ...walk('security'), ...publicScriptFiles()];
const PUBLIC = ALL.filter((path) => !path.includes('.internal.'));
const isTest = (path: string) => path.startsWith('src/__tests__/');

/** Words written in capitals because that is how they are spelled: acronyms, units, formats,
 *  library namespaces and abbreviations. Any other all-caps word in prose is emphasis. */
const ACRONYMS = new Set(('AA AAA AABB AAC ABI AES AI ANSI API ARIA ASCII AST AV AVIF AZERTY BCP BFS BL BM BOM BR BT BYO BYOK CCW '
  + 'CDN CDP CI CIE CJK CLDR CLI CN COPYING CORS CPU CRC CSP CSS CTA CW DCT DD DEV DFS DNS DOM DPR EBML EOF '
  + 'ESA EXIF FAQ FCR FIFO FIPS FNV FOV FPS GB GC GCM GET GF GL GLB GLM GLSL GPT GPU HDR HEAD HEIF HEVC HMM '
  + 'HSL HSTS HSV HTML HTTP HTTPS HUD ICP ICU ID IDAT IDS IEND IHDR II IIFE IME IO IP ISO ITU IV JPEG JPG JS '
  + 'JSBN JSON JSX KB LAN LCG LE LICENCE LICENSE LLM LOD LRU LTR MB MIME MM MMDD MP MSAA NCHW NDC NE NFC NFD '
  + 'NFKC NOTICE NUL NW OCR OK ONNX OS PBR PDF PIXI PNG POSIX POST PRNG PSB PSD PUT PWA QQ QR RAF RAM RFN '
  + 'RGB RGBA RLE RMS RNG RS RTL SDK SE SHA SIMD SPA SSE SSIM SSOT SSR SSSS SVG SW TBD THREE TL TR TS TSX UA '
  + 'UI URI URL US USB UTC UTF UUID UV UX WAAPI WASD WASM WCAG WEBP XHR XOR XY XZ YUV YYYY ZIP ZW').split(' '));
const CAPS_WORD = /(?<![\w./-])[A-Z]{2,}(?![\w/-]|\.\w)/g;
/** A hyphenated run of capitals (`GROUND-LEVEL`). It names something when a part carries a digit
 *  (`SHA-256`, `UTF-16`) or every part is an acronym or a letter (`AES-GCM`, `ITU-R`); a rule id
 *  opens with one letter (`V-PLACE-TRAIT`) and is not matched. */
const CAPS_HYPHENATED = /(?<![\w./-])[A-Z]{2,}(?:-[A-Z0-9]+)+(?![\w/-]|\.\w)/g;
/** Code spans and quoted literals name things; their capitals are not emphasis. */
const QUOTED = /`[^`\n]*`|(?<![A-Za-z])'[^'\n]*'(?![A-Za-z])|"[^"\n]*"|https?:\S+/g;

function capsWords(text: string): number {
  const prose = text.replace(QUOTED, ' ');
  const hyphenated = [...prose.matchAll(CAPS_HYPHENATED)].filter((m) => {
    const parts = m[0].split('-');
    return !parts.some((part) => /\d/.test(part)) && !parts.every((part) => part.length === 1 || ACRONYMS.has(part));
  });
  return [...prose.matchAll(CAPS_WORD)].filter((m) => !ACRONYMS.has(m[0])).length + hyphenated.length;
}

/** An article capitalized inside a sentence (`is A count`), or a capital possessive (`the ramp'S`).
 *  A capital letter that names something stays: one after a label noun (`map A`, `Rule A`) or
 *  before a connective (`A and B`, `A then B`). */
const MID_ARTICLE = /(?<=\b([A-Za-z]+)[,;]? )An? (?=([a-z]+))/g;
const LABEL_NOUNS = new Set(['map', 'rule', 'branch', 'sheet', 'group', 'view', 'cell', 'row', 'column', 'job', 'side', 'stage',
  'case', 'option', 'point', 'plan', 'version', 'model', 'run', 'round', 'sample', 'set', 'type', 'file']);
const CONNECTIVES = new Set(['and', 'or', 'then', 'to', 'vs', 'versus']);
const CAPITAL_POSSESSIVE = /\b[a-z]+'S\b/g;
/** Function words and adverbs, which name nothing, capitalized between two lower-case words
 *  (`the cell Already was`): emphasis lowered to its first letter. A word after a JSDoc tag opens
 *  the tag's sentence. A label quoted as a code span or in quotes is not read. */
const MID_WORDS = ['Already', 'Also', 'Always', 'And', 'Any', 'Are', 'Before', 'Both', 'But', 'Cannot', 'Each', 'Either',
  'Even', 'Every', 'Exactly', 'First', 'For', 'Inside', 'Is', 'Its', 'Just', 'Must', 'Neither', 'Never', 'No', 'Not', 'Only',
  'Or', 'Outside', 'Over', 'Own', 'Partially', 'Real', 'Same', 'Still', 'The', 'Then', 'This', 'Was', 'Were', 'With'];
const MID_WORD = new RegExp(`(?<=(?<![@\\w])[a-z]+[,;]? )(?:${MID_WORDS.join('|')})(?= [a-z(])`, 'g');
/** A comment's prose on one line: wrapped lines joined, their `*` and `//` leaders dropped. */
const unwrapped = (text: string): string => text.replace(/\n\s*(?:\*(?!\/)|\/\/)?\s*/g, ' ');

function midCapitals(text: string): number {
  const prose = unwrapped(text).replace(QUOTED, ' ');
  const articles = [...prose.matchAll(MID_ARTICLE)].filter((m) => !LABEL_NOUNS.has(m[1]!.toLowerCase()) && !CONNECTIVES.has(m[2]!));
  return articles.length + [...prose.matchAll(CAPITAL_POSSESSIVE)].length + [...prose.matchAll(MID_WORD)].length;
}

/** A task, lane or review id: work tracking, which belongs in the tracker. */
const WORK_ITEM = /\bT\d{1,3}\b|\b(?:[Ll]ane|[Rr]ound|[Ss]print|[Tt]icket|[Ss]tage|[Ww]ave)\s+[A-Z]\d+\b/g;

/** A measurement anecdote in shipped code: what a run once showed, with its numbers. The evidence
 *  belongs with the private records; the code keeps the rule it led to. */
const MEASUREMENT = /(?<!\b(?:be|been|being|is|are|was|were|than)\s+)\bmeasured\b(?=\s*[:,~(]|\s+(?:\d|exactly|roughly|about|on (?:real|the (?:reference|seed|benchmark|gate)|a software|one seed|both|ten|twenty|sixty)|over (?:\d|the (?:benchmark|gate|batch)|both|these|ten|twenty|sixty|six|eighteen)))|\b(?:\d+|one|two|three|nine|eight) (?:seeds?|runs?|maps?) of (?:\d+|ten|twenty|forty|sixty)\b|\b\d+ of \d+ (?:seeds|runs|maps)\b/gi;

/** Longest comment block, in lines: a file's header, and any other comment. Consecutive line
 *  comments are one block. */
const HEADER_LINES = 20;
const BLOCK_LINES = 12;

function blocks(path: string, text: string): { lines: number; header: boolean }[] {
  const found: { start: number; end: number; header: boolean }[] = [];
  const list = comments(path, text);
  list.forEach((c, i) => {
    const prev = list[i - 1];
    const last = found[found.length - 1];
    if (prev && last && prev.text.startsWith('//') && c.text.startsWith('//') && /^[ \t]*\r?\n[ \t]*$/.test(text.slice(prev.end, c.pos))) last.end = c.endLine;
    else found.push({ start: c.line, end: c.endLine, header: i === 0 });
  });
  return found.map((b) => ({ lines: b.end - b.start + 1, header: b.header }));
}

/** A JSDoc block followed by another comment, a closing bracket or the end of the file documents
 *  nothing: the compiler attaches it to no declaration. The file's first comment, with nothing but
 *  imports before it, is its header. */
function detachedDocs(path: string, text: string): number {
  return comments(path, text).filter((c, i) => !(i === 0 && /^\s*(?:import\b[^;]*;\s*)*$/.test(text.slice(0, c.pos))) && /^\/\*\*(?!\/)/.test(c.text)
    && /^(?:\/[/*]|[}\])]|$)/.test(text.slice(c.end).trimStart())).length;
}

/** The file's first comment opens with the file's own path, name or name without extension: a
 *  header that restates where it lives says nothing the path does not. */
function selfNamingHeader(path: string, text: string): boolean {
  const first = comments(path, text)[0];
  if (!first) return false;
  const opening = first.text.replace(/^\/\*+|^\/\//, '').split('\n')
    .map((line) => line.replace(/^\s*\*?\s*/, '').trim()).find((line) => line !== '') ?? '';
  const base = path.slice(path.lastIndexOf('/') + 1);
  const named = /^([\w./-]+)/.exec(opening)?.[1] ?? '';
  return named.startsWith('src/') || named === base || named === base.slice(0, base.indexOf('.'));
}

function scan(): Record<Check, Map<string, number>> {
  const found = Object.fromEntries(CHECKS.map((c) => [c, new Map<string, number>()])) as Record<Check, Map<string, number>>;
  const add = (check: Check, path: string, n: number) => { if (n > 0) found[check].set(path, (found[check].get(path) ?? 0) + n); };
  for (const path of ALL) {
    const text = readFileSync(path, 'utf8') as string;
    if (selfNamingHeader(path, text)) add('selfNaming', path, 1);
    if (!PUBLIC.includes(path)) continue;
    for (const c of comments(path, text)) {
      add('caps', path, capsWords(c.text));
      add('midCapital', path, midCapitals(c.text));
      add('workItem', path, [...c.text.replace(QUOTED, ' ').matchAll(WORK_ITEM)].length);
      if (!isTest(path)) add('measurement', path, [...c.text.matchAll(MEASUREMENT)].length);
    }
    add('longBlock', path, blocks(path, text).filter((b) => b.lines > (b.header ? HEADER_LINES : BLOCK_LINES)).length);
    add('detachedDoc', path, detachedDocs(path, text));
  }
  return found;
}

const found = scan();

describe('comment style', () => {
  it.each(CHECKS)('holds no %s comment', (check) => {
    const over = [...found[check]].filter(([, n]) => n > 0).map(([path, n]) => `${path}: ${n}`);
    expect(over, FIX[check]).toEqual([]);
  });

  it('reads emphasis, work items and measurements, and leaves acronyms, names and units alone', () => {
    expect(capsWords('// The walk NEVER ENDS here.')).toBe(2);
    expect(capsWords('// Draws ONE ring.')).toBe(1);
    expect(capsWords('// Reads JSON from a URL; meets WCAG AA.')).toBe(0);
    expect(capsWords("// Matches `PARTIALLY REVERTED:` and the 'NOT FOUND' code; V-PLACE-TRAIT runs.")).toBe(0);
    expect(capsWords('// The GROUND-LEVEL cut and CYCLE-OFF-KEEPS-BASE hold.')).toBe(2);
    expect(capsWords('// Hashes with SHA-256 over UTF-16 text and AES-GCM; N-1 is the tier below.')).toBe(0);
    expect(midCapitals('// It is A count, not A texture of A map; What A run rests on A reading; the ramp\'S own span.')).toBe(6);
    expect(midCapitals('// A dim over a card; map A then B, Rule A for one edge, and `A` itself.')).toBe(0);
    expect(midCapitals('/** What the cell\n *  Already was; a body Partially covers it, and it is Not the one. */')).toBe(3);
    expect(midCapitals('// Press Help in Chrome; @returns The count; the "For later" answer; Ctrl or Shift.')).toBe(0);
    expect('// (T8: a quarter of the pictures)'.match(WORK_ITEM)).toHaveLength(1);
    expect('// The L2 cliff over an R0 term; lane width 3.'.match(WORK_ITEM)).toBeNull();
    expect('// measured: 3 of 20 seeds ended low; one seed of sixty lost it.'.match(MEASUREMENT)).toHaveLength(3);
    expect('// Distances are measured in macro cells, measured from the anchor.'.match(MEASUREMENT)).toBeNull();
  });

  it('reads a JSDoc attached to nothing, and leaves a header and a documented declaration alone', () => {
    expect(detachedDocs('a.ts', '/** Header. */\n\n/** Doc. */\nexport const x = 1;')).toBe(0);
    expect(detachedDocs('a.ts', "import { y } from './y';\n/** Header. */\n/** Doc. */\nexport const x = y;")).toBe(0);
    expect(detachedDocs('a.ts', 'const y = 0;\n/** Stale. */\n/** Doc. */\nexport const x = 1;')).toBe(1);
    expect(detachedDocs('a.ts', 'function f() {\n  return 1;\n  /** Trailing. */\n}')).toBe(1);
  });

  it('reads a self-naming header in each comment form, and leaves a describing one alone', () => {
    expect(selfNamingHeader('src/a/b.ts', '// src/a/b.ts\nconst x = 1;')).toBe(true);
    expect(selfNamingHeader('src/a/b.ts', '/*\n * b.ts: the thing.\n */\nconst x = 1;')).toBe(true);
    expect(selfNamingHeader('src/a/key-token.ts', '/*\n * key-token: the thing.\n */\nconst x = 1;')).toBe(true);
    expect(selfNamingHeader('src/a/b.ts', "import x from './x';\n/** b.ts: the thing. */\nconst y = x;")).toBe(true);
    expect(selfNamingHeader('src/a/b.ts', '/** The thing; see c.ts. */\nconst x = 1;')).toBe(false);
    expect(selfNamingHeader('src/a/b.ts', 'const x = 1;')).toBe(false);
  });
});
