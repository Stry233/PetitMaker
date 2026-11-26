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
import { bool, int, list, obj, oneOf, req, str } from './schema';

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

/** The most rows and columns of a drawn shape that are read, and the most cells a character may stand for on a side. */
const PICTURE_ROWS = 80, PICTURE_COLUMNS = 120, PICTURE_SCALE_MAX = 6;

/** The most a run written as `mark{count}` repeats its mark. */
const RUN_MAX = 999;

/** A drawn row with every run written as `mark{count}` spelled out: "2{3}.{2}" is "222..". */
export function drawnRow(row: string): string {
  return row.replace(/(.)\{(\d{1,3})\}/gu, (_, mark: string, count: string) => mark.repeat(Math.min(RUN_MAX, Number(count))));
}

/**
 * The rows of a drawing whose length differs from the commonest, as a sentence naming them, or null
 * when every row is as long as the others.
 */
export function raggedRows(rows: readonly string[]): string | null {
  const lengths = rows.map((row) => [...row].length);
  const seen = new Map<number, number>();
  for (const n of lengths) seen.set(n, (seen.get(n) ?? 0) + 1);
  if (seen.size < 2) return null;
  const usual = [...seen].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
  const off = lengths.flatMap((n, i) => (n === usual ? [] : [`row ${i + 1} is ${n}`])).slice(0, 8);
  return `${off.join(', ')} long where the others are ${usual}`;
}

/**
 * The cells a shape drawn as rows of text marks, its top-left cell at x1,y1 (or x,y): every
 * character but "." and a space is a cell, or a square of `scale` cells on a side. Empty where the
 * input draws nothing or names no corner.
 */
export function pictureCells(input: Record<string, unknown>): { x: number; y: number }[] {
  if (!Array.isArray(input.picture)) return [];
  const ox = Number(input.x1 ?? input.x), oy = Number(input.y1 ?? input.y);
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return [];
  const asked = Math.trunc(Number(input.scale));
  const scale = Number.isFinite(asked) ? Math.min(PICTURE_SCALE_MAX, Math.max(1, asked)) : 1;
  const drawn: { x: number; y: number }[] = [];
  (input.picture as unknown[]).slice(0, PICTURE_ROWS).forEach((row, dy) => {
    [...drawnRow(String(row))].slice(0, PICTURE_COLUMNS).forEach((mark, dx) => {
      if (mark === '.' || mark === ' ') return;
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) drawn.push({ x: ox + dx * scale + i, y: oy + dy * scale + j });
    });
  });
  return drawn;
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
import { cellsBounds, rectsBounds, type Rect } from '../../core/grid/rect';

export type { CellBox };

function boxOf(x1: number, y1: number, x2: number, y2: number): CellBox {
  return {
    origin: { x: Math.min(x1, x2), y: Math.min(y1, y2) },
    width: Math.abs(x2 - x1) + 1,
    height: Math.abs(y2 - y1) + 1,
  };
}

const cellBox = (r: Rect | null): CellBox | undefined => (r ? { origin: { x: r.x, y: r.y }, width: r.w, height: r.h } : undefined);

function listBox(raw: unknown): CellBox | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cells = raw.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const x = Math.round(num((item as Record<string, unknown>).x));
    const y = Math.round(num((item as Record<string, unknown>).y));
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });
  return cellBox(cellsBounds(cells));
}

/**
 * The cells a call's arguments name, as their bounding box: a drawn shape, a rect, a line, a circle,
 * a cell or path list, or a single point. Undefined where the arguments name no place (an object id, a recipe).
 */
export function callFootprint(input: Record<string, unknown> | undefined): CellBox | undefined {
  if (!input) return undefined;
  const drawn = listBox(pictureCells(input));
  if (drawn) return drawn;
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
  return cellBox(rectsBounds(boxes.flatMap((b) => (b ? [{ x: b.origin.x, y: b.origin.y, w: b.width, h: b.height }] : []))));
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
  shape: oneOf(['rect', 'circle', 'line', 'cells', 'picture'], {
    description: 'Area form: "rect" fills x1,y1..x2,y2 (inclusive corners); "circle" fills radius r around cx,cy; "line" strokes x1,y1..x2,y2 at width; "cells" reads the cells array; "picture" reads a shape drawn as rows of text from x1,y1.',
  }),
  ...coordProps,
  cx: int(),
  cy: int(),
  r: int({ min: 1 }),
  width: int({ min: 1, description: 'Line stroke width (default 1).' }),
  outline: bool({ description: 'With rect or circle: only the border cells (e.g. a mountain rim to contain water).' }),
  cells: list(cellItem, { description: 'Explicit cell list, for shape "cells".' }),
  picture: list(str(), { description: 'For shape "picture": the shape drawn as rows of text, top row first, its top-left cell at x1,y1. "#" is a cell of the shape, "." is not. Draw any outline this way: a star, a letter, a crescent, an island with coves. Make the rows mirror images of themselves when the shape should be symmetric. Write a run of one mark as the mark and its count in braces: "#{12}.{4}" is twelve "#" then four ".".' }),
  scale: int({ min: 1, max: PICTURE_SCALE_MAX, description: 'For shape "picture": how many cells each character stands for on a side (default 1). At 4 a row of 35 characters spans 140 cells, for outlines at island scale.' }),
  rect: obj(corners, { description: 'Nested alternative to shape "rect".' }),
  circle: obj({ cx: req(int()), cy: req(int()), r: req(int({ min: 1 })) }, { description: 'Nested alternative to shape "circle".' }),
  line: obj({ ...corners, width: int({ min: 1, description: 'Stroke width (default 1).' }) }, { description: 'Nested alternative to shape "line".' }),
};
