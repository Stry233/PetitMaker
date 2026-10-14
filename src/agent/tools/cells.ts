/** Where a write may land: the cells a call's geometry names, clipped to buildable, unoccupied ground. */
import type { GridState, MacroCoord } from '../../core/model/types';
import { entriesNear, getObjectIndex } from '../../state/object-index';
import { circleCells, lineCells } from '../../core/grid/shapes';
import { rectsOverlap, cellKey } from '../../core/grid/rect';
import { isBuildableZone } from '../../core/game/zones';
import { clamp } from '../../core/base/math';
import { terrainCellRect } from '../../core/grid/grid-convert';
import { normalizeGeometry, type FlatDefault } from './geometry';
import { argError } from './feedback';
import type { ToolOutcome } from './spec';
import { BUILDABLE_ZONES, UNBUILDABLE_ZONES, lockedNote, orList } from './game-terms';

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

/** The one sentence a clipped write appends where anything was clipped. */
export function offZoneNote(offZone: number): string {
  return offZone > 0 ? ` ${offZone} cell(s) outside the buildable ${BUILDABLE_ZONES} zone were skipped.` : '';
}

/** The refusal a write whose every cell clipped away answers with. */
export function offZoneError(): ToolOutcome {
  return argError(`every cell lies outside the buildable ${BUILDABLE_ZONES} zone (${orList(UNBUILDABLE_ZONES)}), aim inside it.`);
}

/** The paint cells a NON-coating object footprint covers, filtered out: terrain under a standing
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
  return occupied > 0 ? ` ${occupied} cell(s) under standing objects were skipped. Those objects remain unchanged; this did not replace or remove them. Inspect the objects before correcting a missing part. ${lockedNote()}` : '';
}

/* ── input helpers ───────────────────────────────────────────────────── */

/** Resolve a shape input — nested (rect / circle / line / cells) or flat (shape + top-level
 *  scalars), optional outline — into a deduped, in-bounds cell list. `flatDefault` is what bare
 *  corners with no `shape` mean: a rect for the area tools, the line for build_road. */
export function resolveCells(input: Record<string, unknown>, state: GridState, flatDefault: FlatDefault = 'rect'): MacroCoord[] {
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
