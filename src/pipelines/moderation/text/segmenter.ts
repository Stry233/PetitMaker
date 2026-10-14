export type LexiconIndex = { version: number; logTotal: number; groups: Record<string, { words: string; weights: string }> };
/** One byte holds ln(frequency) × 16; the largest source frequency needs about 190. */
export const LEXICON_SCALE = 16;
/** Longest lexicon word in code points; the Viterbi window stops here. */
const MAX_WORD = 8;
const HAN = /\p{Script=Han}/u;

let weights: Map<string, number> | null = null;
let general: Set<string> | null = null;
let logTotal = 0;
let loading: Promise<void> | null = null;
const extra = new Set<string>();

/** A matcher's answer, and whether it rests on the segmentation lexicon not loaded yet: a
 *  provisional verdict is evaluated again once `loadLexicon` resolves. */
export interface Provisional<T> { verdict: T; provisional: boolean }

export function lexiconLoaded(): boolean {
  return weights !== null;
}

/** Restriction phrases must be candidate words, otherwise the most probable path never keeps them whole. */
export function addLexiconWords(words: Iterable<string>): void {
  for (const word of words) extra.add(word);
  if (weights) for (const word of extra) if (!weights.has(word)) weights.set(word, 0);
}

export function loadLexicon(): Promise<void> {
  loading ??= import('../../../assets/moderation/lexicon-index.json').then(({ default: index }) => install(index as LexiconIndex));
  return loading;
}

export function installLexicon(index: LexiconIndex): void {
  install(index);
  loading = Promise.resolve();
}

/** Every lexicon word with its natural-log frequency. */
export function* lexiconEntries(index: LexiconIndex): Generator<[string, number]> {
  for (const [lengthKey, group] of Object.entries(index.groups)) {
    const length = Number(lengthKey);
    const bytes = Uint8Array.from(atob(group.weights), c => c.charCodeAt(0));
    const chars = [...group.words];
    for (let i = 0; i < bytes.length; i++) yield [chars.slice(i * length, (i + 1) * length).join(''), bytes[i]! / LEXICON_SCALE];
  }
}

function install(index: LexiconIndex): void {
  const table = new Map<string, number>(lexiconEntries(index));
  general = new Set(table.keys());
  for (const word of extra) if (!table.has(word)) table.set(word, 0);
  logTotal = index.logTotal;
  weights = table;
}

/** jieba-style unigram Viterbi without the HMM step; unknown single characters count as frequency 1, non-Han code points are their own tokens, and the result is UTF-16 token offsets or null before loading. */
export function tokenBoundaries(text: string): Set<number> | null {
  if (!weights) return null;
  const chars = [...text];
  const offsets = [0];
  for (const char of chars) offsets.push(offsets[offsets.length - 1]! + char.length);
  const best = new Float64Array(chars.length + 1).fill(-Infinity);
  const back = new Int32Array(chars.length + 1);
  best[0] = 0;
  for (let i = 0; i < chars.length; i++) {
    if (best[i] === -Infinity) continue;
    if (!HAN.test(chars[i]!)) {
      if (best[i]! > best[i + 1]!) { best[i + 1] = best[i]!; back[i + 1] = 1; }
      continue;
    }
    for (let length = 1; length <= MAX_WORD && i + length <= chars.length; length++) {
      const word = chars.slice(i, i + length).join('');
      const weight = weights.get(word) ?? (length === 1 ? 0 : undefined);
      if (weight === undefined) continue;
      const score = best[i]! + weight - logTotal;
      if (score > best[i + length]!) { best[i + length] = score; back[i + length] = length; }
    }
  }
  const boundaries = new Set<number>([0, text.length]);
  for (let i = chars.length; i > 0; i -= back[i]!) boundaries.add(offsets[i - back[i]!]!);
  return boundaries;
}

/** Whether a Han phrase occurrence sits on token boundaries; provisionally yes before the lexicon loads. */
export function spanAligned(text: string, start: number, end: number, boundaries: { current: Set<number> | null }): Provisional<boolean> {
  if (!weights) return { verdict: true, provisional: true };
  boundaries.current ??= tokenBoundaries(text);
  return { verdict: boundaries.current!.has(start) && boundaries.current!.has(end), provisional: false };
}

/** Whether a Han span is ordinary text: a lexicon word or a run of multi-character lexicon words; a single-character token marks a misspelling. Provisionally no before loading. */
export function ordinarySpan(span: string): Provisional<boolean> {
  const known = general;
  if (!known) return { verdict: false, provisional: true };
  if (known.has(span)) return { verdict: true, provisional: false };
  const cuts = [...tokenBoundaries(span)!].sort((a, b) => a - b);
  return {
    verdict: cuts.slice(1).every((end, i) => { const token = span.slice(cuts[i], end); return [...token].length >= 2 && known.has(token); }),
    provisional: false,
  };
}

