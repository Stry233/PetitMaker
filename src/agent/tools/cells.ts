/** Where a write may land: the cells a call's geometry names, clipped to buildable, unoccupied ground. */
import type { GridState, MacroCoord } from '../../core/model/types';
import { entriesNear, getObjectIndex } from '../../state/object-index';
import { circleCells, lineCells } from '../../core/grid/shapes';
import { rectsOverlap, cellKey, regionBounds } from '../../core/grid/rect';
import { isBuildableZone } from '../../core/game/zones';
import { paintBleedsOffBuildable } from '../../rules/zone-restriction';
import { clamp } from '../../core/base/math';
import { terrainCellRect } from '../../core/grid/grid-convert';
import { footprintCells, footprintTerrain, terrainCellsUnder } from '../../core/grid/footprint';
import { normalizeGeometry, pictureCells, type FlatDefault } from './geometry';
import { argError } from './feedback';
import type { ToolOutcome } from './spec';
import { BUILDABLE_ZONES, UNBUILDABLE_ZONES, lockedNote, orList } from './game-terms';

/* ── the one grid the assistant works in ─────────────────────────────── */

/**
 * The assistant names object cells only. A terrain tool given object cells edits the terrain those
 * cells rest on: the union of the terrain cells under each, which is centred on the same line as the
 * object cells and reaches half a cell past them on every side. Every terrain tool's geometry passes
 * through here; cells off the map are dropped.
 */
export function terrainUnder(cells: readonly MacroCoord[], state: GridState): MacroCoord[] {
  const { width, height } = state.template;
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  for (const c of cells) {
    for (const t of terrainCellsUnder({ x: c.x, y: c.y, w: 1, h: 1 })) {
      if (t.x < 0 || t.y < 0 || t.x >= width || t.y >= height) continue;
      const k = cellKey(t.x, t.y);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
  }
  return out;
}

export type Corners = { x1: number; y1: number; x2: number; y2: number };

/** `terrainUnder` for a whole rectangle of object cells, as inclusive corners of terrain cells. */
export function terrainRectUnder(r: Corners): Corners {
  const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2);
  const t = footprintTerrain({ x, y, w: Math.abs(r.x2 - r.x1) + 1, h: Math.abs(r.y2 - r.y1) + 1 });
  return { x1: t.x, y1: t.y, x2: t.x + t.w - 1, y2: t.y + t.h - 1 };
}

/** The object cells that rest, wholly or in part, on any of `terrain`, as inclusive corners; null for none. */
export function objectCellsOver(terrain: readonly MacroCoord[]): Corners | null {
  const box = regionBounds(terrain.flatMap((t) => { const r = terrainCellRect(t); return footprintCells(r.x, r.y, r.w, r.h); }));
  return box && { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 };
}

/** How many of the object `cells` rest wholly on `terrain`, the part of each that is on the map; a
 *  cell with no part on the map rests on nothing. */
export function restingWholly(cells: readonly MacroCoord[], terrain: readonly MacroCoord[], state: GridState): number {
  const kept = new Set(terrain.map((t) => cellKey(t.x, t.y)));
  return cells.filter((c) => {
    const under = terrainUnder([c], state);
    return under.length > 0 && under.every((t) => kept.has(cellKey(t.x, t.y)));
  }).length;
}

/** The corners of `cells` where they fill their bounding rectangle, else null. */
function filledRect(cells: readonly MacroCoord[]): Corners | null {
  const box = regionBounds(cells);
  return box && box.count === (box.x2 - box.x1 + 1) * (box.y2 - box.y1 + 1) ? { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 } : null;
}

/**
 * Where objects stand around terrain laid under a filled rectangle of object cells: the cells
 * touching it rest partly on it, so the nearest clear ones are the border of the rectangle one cell
 * beyond those, the same distance out on every side. Empty for an irregular shape.
 */
export function clearBorderNote(asked: readonly MacroCoord[], state: GridState): string {
  const over = filledRect(asked) && objectCellsOver(terrainUnder(asked, state));
  if (!over) return '';
  return ` The nearest cells where objects stand clear of it are the border of the rectangle (${over.x1 - 1},${over.y1 - 1})-(${over.x2 + 1},${over.y2 + 1}).`;
}

/** The cells a write may actually reach: the buildable zones. Every other zone refuses every edit
 *  (V-ZONE-01), and the zone map is static — so a write's geometry is
 *  clipped up front and the result names the count, instead of one off-zone corner failing or
 *  reverting the whole stroke. Read tools never clip: a look at the sea is a legitimate look. */
export function clipBuildable(cells: MacroCoord[], state: GridState): { cells: MacroCoord[]; offZone: number } {
  const kept = cells.filter((c) => {
    const zone = state.cells[c.y]?.[c.x]?.zone;
    return zone !== undefined && isBuildableZone(zone);
  });
  return { cells: kept, offZone: cells.length - kept.length };
}

/** The terrain cells a paint may actually raise or flood: buildable, and not beside the shore, where a
 *  block bleeds half a cell up and left onto ground V-ZONE-01 refuses. An erase does not bleed, so
 *  only a paint clips by this. */
export function clipPaintable(cells: MacroCoord[], state: GridState): { cells: MacroCoord[]; offZone: number } {
  const kept = clipBuildable(cells, state).cells.filter((c) => !paintBleedsOffBuildable(state, c));
  return { cells: kept, offZone: cells.length - kept.length };
}

/** The one sentence a clipped write appends where anything was clipped. */
export function offZoneNote(offZone: number): string {
  return offZone > 0 ? ` ${offZone} cell(s) outside the buildable ${BUILDABLE_ZONES} zone were skipped.` : '';
}

/** The refusal a write whose every cell clipped away answers with. */
export function offZoneError(): ToolOutcome {
  return argError(`every cell lies outside the buildable ${BUILDABLE_ZONES} zone (${orList(UNBUILDABLE_ZONES)}), aim inside it.`);
}

/** The terrain cells a NON-coating object footprint covers, filtered out: terrain under a standing
 *  object is never paintable (V-PLACE-BLOCK), and the rule's own fix is clear_area first. Roads
 *  and other coatings ride surface changes and do not block. */
export function clipOccupied(cells: MacroCoord[], state: GridState): { cells: MacroCoord[]; occupied: number } {
  const index = getObjectIndex(state);
  const kept = cells.filter((c) => {
    const fp = terrainCellRect(c);
    for (const e of entriesNear(index, fp)) {
      if (e.coating) continue;
      if (rectsOverlap(e.rect, fp)) return false;
    }
    return true;
  });
  return { cells: kept, occupied: cells.length - kept.length };
}

/** The sentence an occupied-clipped paint appends where anything was clipped. */
export function occupiedNote(occupied: number): string {
  return occupied > 0 ? ` ${occupied} cell(s) under or touching standing objects were skipped or cut short. Those objects remain unchanged; this did not replace or remove them. Inspect the objects before correcting a missing part. ${lockedNote()}` : '';
}

/* ── input helpers ───────────────────────────────────────────────────── */

/** Resolve a shape input — nested (rect / circle / line / cells) or flat (shape + top-level
 *  scalars), optional outline — into a deduped, in-bounds cell list. `flatDefault` is what bare
 *  corners with no `shape` mean: a rect for the area tools, the line for build_road. */
export function resolveCells(input: Record<string, unknown>, state: GridState, flatDefault: FlatDefault = 'rect'): MacroCoord[] {
  // A shape drawn as rows of text is its marked cells; an empty drawing leaves the other geometry to speak.
  if (Array.isArray(input.picture) && input.picture.length > 0) {
    const { picture: _picture, shape: _shape, x1: _x1, y1: _y1, x2: _x2, y2: _y2, ...rest } = input;
    input = { ...rest, shape: 'cells', cells: pictureCells(input) };
  }
  input = normalizeGeometry(input, flatDefault);
  const outline = Boolean(input.outline);
  const { width, height } = state.template;
  let cells: MacroCoord[] = [];
  const rect = input.rect as { x1: number; y1: number; x2: number; y2: number } | undefined;
  const circle = input.circle as { cx: number; cy: number; r: number } | undefined;
  const line = input.line as { x1: number; y1: number; x2: number; y2: number; width?: number } | undefined;
  // Every shape's raw extent is clamped to the map before enumerating cells.
  // Out-of-bounds cells are dropped by the final filter anyway, so clamping the
  // iteration window is output-preserving; without it a model that passes a
  // huge or off-map rect/circle/line (a common coordinate mistake) would make
  // this loop run for billions of iterations and freeze the tab. NaN inputs
  // collapse to an empty range here rather than looping forever.
  const cx0 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, width - 1);
  const cy0 = (v: number) => clamp(Number.isFinite(v) ? v : 0, 0, height - 1);
  if (rect) {
    // real (unclamped) edges decide which cells are the outline border; the
    // loop only walks the in-bounds window
    const rxa = Math.min(rect.x1, rect.x2), rxb = Math.max(rect.x1, rect.x2);
    const rya = Math.min(rect.y1, rect.y2), ryb = Math.max(rect.y1, rect.y2);
    if (Number.isFinite(rxa) && Number.isFinite(rya)) {
      for (let y = cy0(rya); y <= cy0(ryb); y++) {
        for (let x = cx0(rxa); x <= cx0(rxb); x++) {
          if (!outline || x === rxa || x === rxb || y === rya || y === ryb) cells.push({ x, y });
        }
      }
    }
  } else if (circle) {
    // a radius larger than the map already covers every in-bounds cell, so cap
    // it at the map diagonal — same output, bounded work
    const r = clamp(Number.isFinite(circle.r) ? circle.r : 0, 0, width + height);
    const c = { x: cx0(circle.cx), y: cy0(circle.cy) };
    cells = circleCells(c, r, r);
    if (outline && r > 1) {
      const inner = new Set(circleCells(c, r - 1, r - 1).map((cc) => cellKey(cc.x, cc.y)));
      cells = cells.filter((cc) => !inner.has(cellKey(cc.x, cc.y)));
    }
  } else if (line) {
    // a line walks from end to end; an endpoint far off-map would enumerate a
    // huge span before the filter trims it. Reject the pathological case (the
    // in-bounds segment of a wildly off-map line is ambiguous anyway) and cap
    // width to a sane brush size.
    const span = Math.max(Math.abs(line.x2 - line.x1), Math.abs(line.y2 - line.y1));
    if (!Number.isFinite(span) || span > (width + height) * 2) return [];
    const w = clamp(Math.max(1, Number(line.width) || 1), 1, Math.max(width, height));
    cells = lineCells({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, w);
  } else {
    cells = (input.cells as MacroCoord[] | undefined) ?? [];
  }
  const seen = new Set<string>();
  return cells.filter((c) => {
    if (c.x < 0 || c.y < 0 || c.x >= width || c.y >= height) return false;
    const k = cellKey(c.x, c.y);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
