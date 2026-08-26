/**
 * The pure half of the flash overlays (no Pixi/three, unit-testable — same pattern as
 * chunk-cull): resolve validation errors / undo-redo steps to the cells the flash should
 * light, and the shared decay curve. Both renderers import from here.
 */
import type { GridState, MacroCoord, PlacedObject, Rect, ValidationError } from '../../../core/model/types';
import { getFootprint } from '../../../core/model/grid-model';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { getObjectIndex, objectAt } from '../../../state/object-index';

/** An error-flash cell resolved to the grid it renders on (`micro` = terrain, −HALF_TILE). */
export interface ErrorFlashCell { x: number; y: number; micro: boolean }

/** An error-flash BODY: the exact rect an error names (`ValidationError.rects` — an object's
 *  footprint, or two footprints' overlap), on the grid it renders on. Drawn instead of that
 *  error's cells, which can only approximate a body that sits on the half grid. */
export interface ErrorFlashRect extends Rect { micro: boolean }

/** The flash intensity curve, shared by BOTH renderers so 2D (Pixi alpha) and 3D (mesh opacity)
 *  decay identically: one smooth beat, `peak` → 0 as (1 − t²) over normalized age `t` ∈ [0, 1].
 *  The single source for the flash shape, so neither overlay re-types the curve. */
export function flashDecay(peak: number, t: number): number {
  return peak * (1 - t * t);
}

/**
 * Resolve validation errors to flash cells: each error's evidence cells on its
 * own grid (`error.grid`, falling back to the command-type default the caller
 * passes), deduped by (x, y, grid) so overlapping evidence from multiple rules
 * doesn't stack alpha.
 */
/** Identity of one flash: the exact cells and bodies on their grids. */
export function errorFlashSignature(cells: ErrorFlashCell[], rects: readonly ErrorFlashRect[] = []): string {
  return [
    ...cells.map((c) => `${c.x},${c.y},${c.micro ? 1 : 0}`),
    ...rects.map((r) => `${r.x},${r.y},${r.w},${r.h},${r.micro ? 1 : 0}`),
  ].join(';');
}

/** The last flash a gate consumer played: its signature and start time. */
export interface ErrorFlashGate { sig: string; at: number }

/**
 * Whether a new violation flash should play. A freehand brush held over one
 * forbidden region (the plaza, a building) rejects a command per pointer
 * sample — restarting the flash at peak alpha each time strobes solid red for
 * the whole stroke. Identical evidence within the cooldown stays quiet (the
 * flash that already played marks exactly these cells); after the cooldown it
 * may pulse again as a soft reminder. Different evidence always flashes.
 */
export function shouldFlashErrors(prev: ErrorFlashGate | null, sig: string, now: number, cooldownMs: number): boolean {
  if (!prev || prev.sig !== sig) return true;
  return now - prev.at > cooldownMs;
}

/**
 * What a `history-applied` (undo/redo) step should flash: everything it changed, each part on the
 * grid it renders at. An object's footprint is MACRO (no terrain offset) and keeps its own anchor,
 * half-grid included; terrain cells are micro. A step that moved both — a stroke whose road
 * reconcile took a coating with it, a generate — flashes both, since a flash over one of them
 * stops short of what the undo just did. Returns null when there is nothing to flash. Single
 * source shared by both the 2D and 3D renderers.
 */
export function resolveHistoryFlash(
  cells: MacroCoord[], objects: PlacedObject[] | undefined,
): { cells: ErrorFlashCell[] } | null {
  const out: ErrorFlashCell[] = [];
  const seen = new Set<string>();
  const add = (x: number, y: number, micro: boolean): void => {
    const k = `${x},${y},${micro ? 1 : 0}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y, micro });
  };
  for (const o of objects ?? []) {
    const { w, h } = getPlacedObjectSize(o);
    for (const c of getFootprint(o.position.x, o.position.y, w, h)) add(c.x, c.y, false);
  }
  for (const c of cells) add(c.x, c.y, true);
  return out.length > 0 ? { cells: out } : null;
}

/**
 * What a bare cell list should flash when its author never said which grid it is on: the agent's
 * write acknowledgement, whose ONE list can name terrain cells from one tool call and freshly
 * placed objects from the next.
 *
 * Each cell is answered by WHAT STANDS THERE, which is the only source that can be right for both:
 * a cell an object covers flashes that object's whole drawn footprint on the macro grid (the body
 * is what the write produced, and its anchor may be half-grid), everything else flashes as a
 * terrain cell on the micro grid. Each covering object is expanded once however many of its cells
 * the list names.
 */
export function resolveCellsFlash(state: GridState, cells: readonly MacroCoord[]): ErrorFlashCell[] {
  const out: ErrorFlashCell[] = [];
  const seen = new Set<string>();
  const bodies = new Set<string>();
  const index = getObjectIndex(state);
  const add = (x: number, y: number, micro: boolean): void => {
    const k = `${x},${y},${micro ? 1 : 0}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ x, y, micro });
  };
  for (const c of cells) {
    const obj = objectAt(index, c);
    if (!obj) { add(c.x, c.y, true); continue; }
    if (bodies.has(obj.id)) continue;
    bodies.add(obj.id);
    const { w, h } = getPlacedObjectSize(obj);
    for (const f of getFootprint(obj.position.x, obj.position.y, w, h)) add(f.x, f.y, false);
  }
  return out;
}

export function resolveErrorFlashCells(errors: ValidationError[], defaultMicro: boolean): ErrorFlashCell[] {
  const out: ErrorFlashCell[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    // An error that names a DRAWABLE body is drawn as that body: its `cells` are the same evidence
    // rounded out to whole cells, so drawing both would paint the rounding as well. An empty rect
    // is no body, and must not cost the cells their flash — `bodyEvidence` drops those where the
    // pair is derived, and this is the same test at the reading end.
    if (error.rects?.some((r) => r.w > 0 && r.h > 0)) continue;
    const micro = error.grid ? error.grid === 'micro' : defaultMicro;
    for (const { x, y } of error.cells) {
      const key = `${x},${y},${micro ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, micro });
    }
  }
  return out;
}

/**
 * The BODIES the errors name (`ValidationError.rects`), each on its own grid — the exact drawn
 * footprint of an object that refused, or of the overlap between two. Deduped by (rect, grid) so
 * two rules accusing the same body don't stack alpha. Empty for every error that names cells,
 * which is most of them.
 */
export function resolveErrorFlashRects(errors: ValidationError[], defaultMicro: boolean): ErrorFlashRect[] {
  const out: ErrorFlashRect[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    if (!error.rects) continue;
    const micro = error.grid ? error.grid === 'micro' : defaultMicro;
    for (const { x, y, w, h } of error.rects) {
      if (w <= 0 || h <= 0) continue;
      const key = `${x},${y},${w},${h},${micro ? 1 : 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, w, h, micro });
    }
  }
  return out;
}
