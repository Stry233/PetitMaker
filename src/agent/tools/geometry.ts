/**
 * The two spellings of tool geometry, folded into one. Every shape-taking tool
 * accepts a nested form (rect/circle/line objects, a cells array) and a flat
 * form (shape + top-level scalars: x1,y1,x2,y2 / cx,cy,r / width). The flat
 * form exists because a guided decoder that compiles the tool schema into a
 * grammar can drop every optional compound property (nested object, array,
 * free-form string) from what it emits, while optional scalars come through —
 * so the geometry has to be reachable through scalars alone. Pure input
 * plumbing, no map knowledge, so the panel's call describer reads the same
 * contract without loading a tool.
 */
import { bool, int, list, obj, oneOf, req } from './schema';

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
 *  shape is a rect (scatter_objects). */
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

import type { CellBox } from '../core/tool-facts';

export type { CellBox };

function boxOf(x1: number, y1: number, x2: number, y2: number): CellBox {
  return {
    origin: { x: Math.min(x1, x2), y: Math.min(y1, y2) },
    width: Math.abs(x2 - x1) + 1,
    height: Math.abs(y2 - y1) + 1,
  };
}

function listBox(raw: unknown): CellBox | undefined {
  if (!Array.isArray(raw)) return undefined;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const x = Math.round(num((item as Record<string, unknown>).x));
    const y = Math.round(num((item as Record<string, unknown>).y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  return Number.isFinite(x1) ? boxOf(x1, y1, x2, y2) : undefined;
}

/**
 * The cells a call's arguments name, as their bounding box: a rect, a line, a circle, a cell or path
 * list, or a single point. Undefined where the arguments name no place (an object id, a recipe).
 */
export function callFootprint(input: Record<string, unknown> | undefined): CellBox | undefined {
  if (!input) return undefined;
  const g = normalizeGeometry(input);
  for (const key of ['rect', 'line'] as const) {
    const r = g[key] as Record<string, unknown> | undefined;
    if (typeof r !== 'object' || r === null) continue;
    const [x1, y1, x2, y2] = [r.x1, r.y1, r.x2, r.y2].map((v) => Math.round(num(v)));
    if ([x1, y1, x2, y2].every(Number.isFinite)) return boxOf(x1!, y1!, x2!, y2!);
  }
  const c = g.circle as Record<string, unknown> | undefined;
  if (typeof c === 'object' && c !== null) {
    const [cx, cy, r] = [c.cx, c.cy, c.r].map((v) => Math.round(num(v)));
    if ([cx, cy, r].every(Number.isFinite)) return boxOf(cx! - r!, cy! - r!, cx! + r!, cy! + r!);
  }
  const list = listBox(g.cells) ?? listBox(g.path);
  if (list) return list;
  const x = Math.round(num(g.x)), y = Math.round(num(g.y));
  return Number.isFinite(x) && Number.isFinite(y) ? boxOf(x, y, x, y) : undefined;
}

/** The smallest box holding every one of `boxes`, or undefined where there are none. */
function unionBox(boxes: readonly (CellBox | undefined)[]): CellBox | undefined {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const b of boxes) {
    if (!b) continue;
    x1 = Math.min(x1, b.origin.x); y1 = Math.min(y1, b.origin.y);
    x2 = Math.max(x2, b.origin.x + b.width - 1); y2 = Math.max(y2, b.origin.y + b.height - 1);
  }
  return Number.isFinite(x1) ? boxOf(x1, y1, x2, y2) : undefined;
}

/** What a job's record pictures: its painted region, else the union of its writes' footprints;
 *  undefined where neither names a place. */
export function jobFootprint(job: {
  region?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  ops: readonly { isRead: boolean; footprint?: CellBox | undefined }[];
}): CellBox | undefined {
  if (job.region) return boxOf(job.region.x1, job.region.y1, job.region.x2, job.region.y2);
  return unionBox(job.ops.filter((op) => !op.isRead).map((op) => op.footprint));
}

/* ── the two spellings as schema fields ──────────────────────────────── */

export const coordProps = { x1: int(), y1: int(), x2: int(), y2: int() };
export const corners = { x1: req(int()), y1: req(int()), x2: req(int()), y2: req(int()) };
export const cellItem = obj({ x: req(int()), y: req(int()) });
export const nearPoint = obj({ x: int(), y: int() }, { description: 'Nested alternative to nearX/nearY.' });
/** The edge-cut styles a shaping tool rounds its edges with. */
export const SMOOTH_STYLES = ['round', 'rect'] as const;
/** The corner trim styles `trim_corner` lays. */
export const TRIM_STYLES = ['square', 'fan', 'tri', 'empty'] as const;
/** The terrains `paint_terrain` lays. */
export const PAINT_TERRAINS = ['mountain', 'water'] as const;

/** The edge-cut style a shaping tool rounds its edges with. */
export const smoothEdges = (description: string) => oneOf([...SMOOTH_STYLES], { description });

/** The area, flat first: some guided decoders never emit an optional nested object, so every
 *  geometry is reachable through top-level scalars; the nested forms stay accepted beside them. */
export const cellsOrRect = {
  shape: oneOf(['rect', 'circle', 'line', 'cells'], {
    description: 'Area form: "rect" fills x1,y1..x2,y2 (inclusive corners); "circle" fills radius r around cx,cy; "line" strokes x1,y1..x2,y2 at width; "cells" reads the cells array.',
  }),
  ...coordProps,
  cx: int(),
  cy: int(),
  r: int({ min: 1 }),
  width: int({ min: 1, description: 'Line stroke width (default 1).' }),
  outline: bool({ description: 'With rect or circle: paint only the 1-cell border ring (e.g. a mountain rim to contain water).' }),
  cells: list(cellItem, { description: 'Explicit cell list, for shape "cells".' }),
  rect: obj(corners, { description: 'Nested alternative to shape "rect".' }),
  circle: obj({ cx: req(int()), cy: req(int()), r: req(int({ min: 1 })) }, { description: 'Nested alternative to shape "circle".' }),
  line: obj({ ...corners, width: int({ min: 1, description: 'Stroke width (default 1).' }) }, { description: 'Nested alternative to shape "line".' }),
};
