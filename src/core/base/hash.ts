/** Deterministic, non-cryptographic FNV-1a 32-bit hash → 8 hex chars.
 *  Used for content/manifest/ledger fingerprints. Not a security primitive. */
export function fnv1a(input: string): string {
  return fnv1a32(input).toString(16).padStart(8, '0');
}

/** The FNV-1a 32-bit offset basis. */
export const FNV_BASIS = 0x811c9dc5;

/** One FNV-1a 32-bit step: `h` with the 32-bit integer `v` folded in, unsigned. */
export function fnv1aStep(h: number, v: number): number {
  return Math.imul(h ^ v, 0x01000193) >>> 0;
}

/** FNV-1a 32-bit over UTF-16 code units as an unsigned integer. `basis` replaces the offset basis
 *  for a seeded variant. */
export function fnv1a32(input: string, basis = FNV_BASIS): number {
  let h = basis >>> 0;
  for (let i = 0; i < input.length; i++) h = fnv1aStep(h, input.charCodeAt(i));
  return h;
}

/** FNV-1a 32-bit over a sequence of 32-bit integers (bytes included), one step each, unsigned. */
export function fnv1aInts(values: Iterable<number>, basis = FNV_BASIS): number {
  let h = basis >>> 0;
  for (const v of values) h = fnv1aStep(h, v);
  return h;
}

/** Stable hash of any JSON-serializable value (object keys sorted recursively). A `Set` or `Map`
 *  throws: it has no own enumerable keys, so every one would hash as `{}`. */
export function hashJSON(value: unknown): string {
  return fnv1a(stableStringify(value));
}

/** `hashJSON` as an unsigned 32-bit integer. */
export function hashJSON32(value: unknown): number {
  return fnv1a32(stableStringify(value));
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v instanceof Set || v instanceof Map) throw new TypeError('hashJSON: a Set or Map has no JSON form');
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}

// Positional hashes: a value fixed by a seed and a place, so a decision read at one place does not
// depend on how many were read before it. Each mix stays the one its callers' output was tuned with.

/** A stable value in [0,1) per (seed, index). */
export function seedHash01(seed: number, i: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (i + 0x165667b1), 0xc2b2ae35);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** A stable unsigned 32-bit hash of one integer. */
export function hashInt32(v: number): number {
  let h = Math.imul(v ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** A stable value in [0,1) from a handful of integers: an FNV-1a step per value, mixed between steps. */
export function hashInts01(...vals: number[]): number {
  let h = FNV_BASIS;
  for (const v of vals) {
    h = fnv1aStep(h, v);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** A stable value in [0,1) for a cell (x, y), a small integer `kind` and a seed. */
export function cellHash01(x: number, y: number, kind: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + kind * 2654435761 + seed * 0x9e3779b9) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
