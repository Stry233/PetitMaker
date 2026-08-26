/*
 * trim-preview.ts — what auto-trim WILL do to a stroke, worked out before the stroke happens.
 *
 * The ghost draws squares, but with auto-trim on the committed shape has rounded or bevelled
 * corners and can gain Γ patches in its notches. The preview runs the REAL trim pass — the same
 * `applyAutoEdgeCut` the commit runs — over a scratch copy of the cells it can touch, so what the
 * ghost promises is what the click produces, and there is no second implementation of the geometry
 * to keep in step.
 *
 * The scratch is a copy-on-write slice, not a clone of the map: the trim pass reads its
 * neighbourhood and writes only inside the stroke's 8-neighbour border, so cloning that region's
 * cells (and the rows holding them) leaves every other read pointing at the live grid.
 *
 * This is the TERRAIN half. A road is an object rather than a cell, so its preview shadows the
 * coating lookup instead of the grid — `road-trim-preview.ts`, reporting the same `TrimmedCell`.
 */
import { CommandType, TerrainType } from '../../core/model/types';
import type {
  AutoEdgeCut, Command, Corners, EditorEvents, GridState, MacroCoord, TerrainCell,
} from '../../core/model/types';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import type { RoadConnSide } from '../../core/edge-cut/road-cut-states';
import { getCell, scratchGrid } from '../../core/model/grid-model';
import { applyCommand } from '../../core/commands/command-apply';
import { EventBus } from '../../core/commands/event-bus';
import { applyAutoEdgeCut } from './auto-edge-cut';

/** One cell of the previewed result: the shape it will hold once the trim pass has run. */
export interface TrimmedCell {
  x: number;
  y: number;
  corners: Corners;
  /** A Γ patch the trim will CREATE — a cell the stroke does not paint but the shape will occupy. */
  patch: boolean;
  /**
   * The connection side this cell's corners are written against — set iff the cell is a paved ROAD
   * tile rather than a terrain block.
   *
   * A road's corners are symbolic canonical-state tokens, not quadrant geometry (see
   * `core/edge-cut/road-cut-states`), so a view that draws them as quadrants draws the wrong shape.
   * Its presence is how a view knows to go through the road polygon instead, and the side is what
   * turns the canonical state to face the way this tile connects.
   */
  road?: RoadConnSide;
}

/**
 * A ghost's shape, in the two forms the tools have one: its RIM (the cells that can be trimmed at
 * all) and a test for whether a cell is inside it.
 *
 * Only the rim matters. An interior cell has a filled neighbour on every side, so no corner of it
 * is convex and no trim pass can touch it — which is what keeps the preview's cost proportional to
 * the shape's outline rather than its area, so a map-sized rectangle previews like a small one.
 */
export interface GhostShape {
  rim: MacroCoord[];
  contains(x: number, y: number): boolean;
}

/** Beyond this many RIM cells the preview is skipped. A whole-map rectangle has a rim of a few
 *  hundred, so this is a backstop against a pathological shape, not a size policy. */
export const TRIM_PREVIEW_MAX_RIM = 4000;

/** The shape of an explicit cell list. */
export function shapeOfCells(cells: readonly MacroCoord[]): GhostShape {
  const inside = new Set(cells.map((c) => key(c.x, c.y)));
  const contains = (x: number, y: number) => inside.has(key(x, y));
  const rim = cells.filter(({ x, y }) =>
    !contains(x - 1, y) || !contains(x + 1, y) || !contains(x, y - 1) || !contains(x, y + 1));
  return { rim, contains };
}

/**
 * The shape of a set of row spans, without ever expanding them to cells.
 *
 * That is the point: the span form exists so a map-sized drag never builds its own cell list, and
 * the rim is the only part of it the trim can reach.
 */
export function shapeOfSpans(spans: readonly { x: number; y: number; w: number }[]): GhostShape {
  const rows = new Map<number, { x: number; w: number }[]>();
  for (const s of spans) {
    const row = rows.get(s.y);
    if (row) row.push({ x: s.x, w: s.w }); else rows.set(s.y, [{ x: s.x, w: s.w }]);
  }
  const contains = (x: number, y: number) => (rows.get(y) ?? []).some((r) => x >= r.x && x < r.x + r.w);
  const rim: MacroCoord[] = [];
  for (const [y, row] of rows) {
    for (const { x, w } of row) {
      for (let cx = x; cx < x + w; cx++) {
        // The ends of the run, and anything the row above or below does not cover.
        if (cx === x || cx === x + w - 1 || !contains(cx, y - 1) || !contains(cx, y + 1)) {
          rim.push({ x: cx, y });
        }
      }
    }
  }
  return { rim, contains };
}

/** `applyCommand` announces object changes; the preview issues terrain commands only, and nothing
 *  is listening to a scratch grid either way. */
const silentBus = new EventBus<EditorEvents>();

const SQUARE: Corners = ['square', 'square', 'square', 'square'];

/** A cell's shape as one comparable value: what the preview is looking for a change in. */
function shapeSig(t: TerrainCell | null | undefined): string {
  return t ? `${t.type}:${t.elevation}:${t.patchOnly ? 1 : 0}:${(t.corners ?? SQUARE).join('')}` : '-';
}

const key = (x: number, y: number): string => `${x},${y}`;
const isSquare = (c: Corners | undefined): boolean => !c || c.every((v) => v === 'square');

/**
 * The cells the trim pass may read or write: the stroke, its 8-neighbour border, and one more ring
 * for the neighbour reads those corners depend on.
 */
export function region(cells: readonly MacroCoord[], pad: number): MacroCoord[] {
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  for (const { x, y } of cells) {
    for (let dy = -pad; dy <= pad; dy++) {
      for (let dx = -pad; dx <= pad; dx++) {
        const k = key(x + dx, y + dy);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x: x + dx, y: y + dy });
      }
    }
  }
  return out;
}

/** Restrict a command to the cells the scratch owns. Anything outside is dropped: the scratch
 *  shares every other cell with the LIVE grid, so applying it there would edit the real map behind
 *  the executor's back — no history, no redraw, and a stroke that then skips those cells because
 *  they already hold what it was going to write. */
function clipToScratch(cmd: Command, owns: (x: number, y: number) => boolean): Command | null {
  if (cmd.type === CommandType.PaintTerrain || cmd.type === CommandType.EraseTerrain) {
    const cells = cmd.cells.filter((c) => owns(c.x, c.y));
    return cells.length > 0 ? { ...cmd, cells } : null;
  }
  if (cmd.type === CommandType.TrimCorners) return owns(cmd.x, cmd.y) ? cmd : null;
  return null;      // the preview issues terrain commands only
}

/**
 * Run the stroke and its trim pass on a scratch grid, and report every cell that ends up with a
 * shape a square ghost would misdraw.
 *
 * The trim commands are gated by the same pre-command rules the live executor runs, so a cut the
 * rules would refuse is never promised. Returns an empty list when there is nothing to show: trim
 * off, too many cells, or a stroke whose corners all stay square.
 */
export function previewAutoTrim(
  state: GridState,
  mode: AutoEdgeCut,
  shape: GhostShape,
  rules: RuleDispatcher,
  plan: (cells: readonly MacroCoord[], on: GridState) => readonly Command[],
  before: readonly Command[] = [],
): TrimmedCell[] {
  if (mode === 'off' || shape.rim.length === 0 || shape.rim.length > TRIM_PREVIEW_MAX_RIM) return [];

  // The rim and the two rings around it: everything the trim reads or writes, and no more. The
  // shape's interior beyond that is never copied, never painted, and never read, so the
  // clipping below drops nothing the trim depends on.
  const touched = region(shape.rim, 2);
  const owned = new Set(touched.map((c) => key(c.x, c.y)));
  const owns = (x: number, y: number) => owned.has(key(x, y));
  const scratch = scratchGrid(state, touched);
  const was = new Map<string, string>();
  for (const { x, y } of touched) was.set(key(x, y), shapeSig(getCell(scratch.cells, x, y)?.terrain));
  const run = (cmd: Command) => {
    const clipped = clipToScratch(cmd, owns);
    if (clipped) applyCommand(clipped, scratch, silentBus);
  };

  // `before` runs first and the plan is made against its result: a curve tweak takes the previous
  // curve off the map before laying the new one, and a mountain stacks on what is under it, so a
  // plan made against the live grid would aim a layer too high.
  for (const cmd of before) run(cmd);
  for (const cmd of plan(touched.filter((c) => shape.contains(c.x, c.y)), scratch)) run(cmd);
  applyAutoEdgeCut({
    gridState: scratch,
    executeCommand: (cmd) => {
      const errors = rules.validatePreCommand(cmd, scratch);
      if (errors.length === 0) run(cmd);
      return { success: errors.length === 0, errors };
    },
  }, mode, shape.rim, []);

  // Only what a square ghost would draw wrongly: a cut shape inside the stroke, or a Γ patch the
  // trim filled a notch with. A cell OUTSIDE the stroke counts only if this preview changed it —
  // the map is full of trim shapes that were already there, and reporting those draws detached
  // wedges and circles over terrain the ghost is not touching.
  const out: TrimmedCell[] = [];
  for (const { x, y } of touched) {
    const t = getCell(scratch.cells, x, y)?.terrain;
    if (!t || t.type === TerrainType.None) continue;
    if (isSquare(t.corners) && !t.patchOnly) continue;
    if (!shape.contains(x, y) && shapeSig(t) === was.get(key(x, y))) continue;
    out.push({ x, y, corners: (t.corners ?? SQUARE) as Corners, patch: !!t.patchOnly });
  }
  return out;
}

/** A plain paint of these cells, for a caller that has no plan to hand (tests, and the shapes whose
 *  footprint is painted at one elevation). */
export function terrainPaint(cells: readonly MacroCoord[], terrainType: TerrainType, elevation: number): Command {
  return { type: CommandType.PaintTerrain, timestamp: 0, cells: [...cells], terrainType, elevation };
}
