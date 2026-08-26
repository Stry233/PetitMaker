/**
 * The two spellings of tool geometry, folded into one. Every shape-taking tool
 * accepts a nested form (rect/circle/line objects, a cells array) and a FLAT
 * form (shape + top-level scalars: x1,y1,x2,y2 / cx,cy,r / width). The flat
 * form exists because a guided decoder that compiles the tool schema into a
 * grammar can drop every OPTIONAL compound property (nested object, array,
 * free-form string) from what it emits, while optional scalars come through —
 * so the geometry has to be reachable through scalars alone. Pure input
 * plumbing, no map knowledge: kept apart from tools-common so the call
 * describer can read the same contract without the stroke runner behind it.
 */

export type FlatDefault = 'rect' | 'line';

/** A number out of model input: absent/null/'' is NaN, never 0. */
const num = (v: unknown): number => (v === undefined || v === null || v === '' ? NaN : Number(v));

const hasNested = (input: Record<string, unknown>): boolean =>
  Boolean(input.rect || input.circle || input.line) || (Array.isArray(input.cells) && input.cells.length > 0);

/**
 * The input with any complete flat geometry rewritten as its nested twin. The
 * nested form wins when both are present; an incomplete flat form passes
 * through untouched so `geometryError` can name what is missing. `flatDefault`
 * is what bare corners mean with no `shape`: a rect for the area tools, the
 * line for build_road.
 */
export function normalizeGeometry(input: Record<string, unknown>, flatDefault: FlatDefault = 'rect'): Record<string, unknown> {
  if (hasNested(input)) return input;
  const x1 = num(input.x1), y1 = num(input.y1), x2 = num(input.x2), y2 = num(input.y2);
  const cx = num(input.cx), cy = num(input.cy), r = num(input.r);
  const corners = [x1, y1, x2, y2].every(Number.isFinite);
  const round = [cx, cy, r].every(Number.isFinite);
  const shape = typeof input.shape === 'string' ? input.shape : round ? 'circle' : corners ? flatDefault : undefined;
  if (shape === 'circle' && round) return { ...input, circle: { cx, cy, r } };
  if (shape === 'rect' && corners) return { ...input, rect: { x1, y1, x2, y2 } };
  if (shape === 'line' && corners) {
    const width = num(input.width);
    return { ...input, line: { x1, y1, x2, y2, ...(Number.isFinite(width) ? { width } : {}) } };
  }
  return input;
}

/** A rect given either nested or as flat corners, for the tools whose only
 *  shape is a rect (scatter_objects, run_generator). */
export function rectInput(input: Record<string, unknown>): { x1: number; y1: number; x2: number; y2: number } | undefined {
  if (input.rect) return input.rect as { x1: number; y1: number; x2: number; y2: number };
  const x1 = num(input.x1), y1 = num(input.y1), x2 = num(input.x2), y2 = num(input.y2);
  return [x1, y1, x2, y2].every(Number.isFinite) ? { x1, y1, x2, y2 } : undefined;
}

/** A point given either as a nested `{x,y}` under `key` or as the flat pair
 *  `<key>X`/`<key>Y` (the site finders' `near`). */
export function pointInput(input: Record<string, unknown>, key: string): { x: number; y: number } | undefined {
  const nested = input[key] as { x: number; y: number } | undefined;
  if (nested && Number.isFinite(num(nested.x)) && Number.isFinite(num(nested.y))) return { x: num(nested.x), y: num(nested.y) };
  const x = num(input[`${key}X`]), y = num(input[`${key}Y`]);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
}

/** Which of `keys` the input lacks a number for — the names an argument
 *  refusal lists so the retry can differ from the call that earned it. */
export function missingScalars(input: Record<string, unknown>, keys: string[]): string[] {
  return keys.filter((k) => !Number.isFinite(num(input[k])));
}
