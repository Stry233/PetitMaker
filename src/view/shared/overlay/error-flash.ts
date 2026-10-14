/**
 * The pure half of the flash overlays (no Pixi/three, unit-testable — same pattern as
 * chunk-cull): resolve validation errors / undo-redo steps to the cells the flash should
 * light, the shared decay curve and the one flash policy (`FlashPolicy`). Both renderers import
 * from here.
 */
import type { PlacedObject, ValidationError } from '../../../core/model/types';
import type { Rect } from '../../../core/grid/rect';
import type { CellSet, GridCellRef, GridId } from '../../../core/grid/grids';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import { placedFootprint } from '../../../state/object-geometry';
import { cellSet } from '../../../core/grid/grids';
import { isMotionReduced } from '../../../platform/channels/motion-state';
import { animConfig } from '../motion/anim-config';

/** An error-flash body: the exact rect an error names (`ValidationError.rects` — an object's
 *  footprint, or two footprints' overlap), on the grid it lies on. Drawn instead of that error's
 *  cells, which can only approximate a body that sits on the half grid. */
export interface ErrorFlashRect extends Rect { grid: GridId }

/** The flash intensity curve, shared by both renderers so 2D (Pixi alpha) and 3D (mesh opacity)
 *  decay identically: one smooth beat, `peak` → 0 as (1 − t²) over normalized age `t` ∈ [0, 1].
 *  The single source for the flash shape, so neither overlay re-types the curve. */
export function flashDecay(peak: number, t: number): number {
  return peak * (1 - t * t);
}

/** Identity of one flash: the exact cells and bodies on their grids. */
function errorFlashSignature(cells: readonly GridCellRef[], rects: readonly ErrorFlashRect[] = []): string {
  return [
    ...cells.map((c) => `${c.x},${c.y},${c.grid}`),
    ...rects.map((r) => `${r.x},${r.y},${r.w},${r.h},${r.grid}`),
  ].join(';');
}

/** The cells of `sets`, each tagged with its set's grid. */
function tagCellSets(sets: readonly CellSet[]): GridCellRef[] {
  return sets.flatMap(({ grid, cells }) => cells.map(({ x, y }) => ({ x, y, grid })));
}

/** The last flash a gate consumer played: its signature and start time. */
interface ErrorFlashGate { sig: string; at: number }

/**
 * Whether a new violation flash should play. A freehand brush held over one
 * forbidden region (a landmark, a building) rejects a command per pointer
 * sample — restarting the flash at peak alpha each time strobes solid red for
 * the whole stroke. Identical evidence within the cooldown stays quiet (the
 * flash that already played marks exactly these cells); after the cooldown it
 * may pulse again as a soft reminder. Different evidence always flashes.
 */
function shouldFlashErrors(prev: ErrorFlashGate | null, sig: string, now: number, cooldownMs: number): boolean {
  if (!prev || prev.sig !== sig) return true;
  return now - prev.at > cooldownMs;
}

/**
 * What a `history-applied` (undo/redo) step should flash: everything it changed, each part on the
 * grid it lies on. An object's footprint lies on the placement grid and keeps its own anchor,
 * half-grid included; the step's cells keep the grids their sets name. A step that moved both — a
 * stroke whose road reconcile took a coating with it, a generate — flashes both, since a flash over
 * one of them stops short of what the undo just did. Single source shared by both renderers.
 */
export function resolveHistoryFlash(cells: readonly CellSet[], objects: PlacedObject[] | undefined): CellSet[] {
  const footprints = (objects ?? []).flatMap(placedFootprint);
  const sets: CellSet[] = [cellSet(PLACEMENT_GRID, footprints), ...cells];
  return sets.filter((set) => set.cells.length > 0);
}

/** Merge `sets` into one cell list, deduped by (x, y, grid) so overlapping parts don't stack alpha. */
function flashCells(sets: readonly CellSet[]): GridCellRef[] {
  const out: GridCellRef[] = [];
  const seen = new Set<string>();
  for (const c of tagCellSets(sets)) {
    const k = `${c.x},${c.y},${c.grid}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

/** Resolve validation errors to flash cells: each error's evidence cells on its own grid, deduped by
 *  (x, y, grid) so overlapping evidence from multiple rules doesn't stack alpha. */
function resolveErrorFlashCells(errors: ValidationError[]): GridCellRef[] {
  const out: GridCellRef[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    // An error that names a drawable body is drawn as that body: its `cells` are the same evidence
    // rounded out to whole cells, so drawing both would paint the rounding as well. An empty rect
    // is no body, and must not cost the cells their flash — `bodyEvidence` drops those where the
    // pair is derived, and this is the same test at the reading end.
    if (error.rects?.some((r) => r.w > 0 && r.h > 0)) continue;
    const { grid } = error;
    for (const { x, y } of error.cells) {
      const key = `${x},${y},${grid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, grid });
    }
  }
  return out;
}

/**
 * The bodies the errors name (`ValidationError.rects`), each on its own grid — the exact drawn
 * footprint of an object that refused, or of the overlap between two. Deduped by (rect, grid) so
 * two rules accusing the same body don't stack alpha. Empty for every error that names cells,
 * which is most of them.
 */
function resolveErrorFlashRects(errors: ValidationError[]): ErrorFlashRect[] {
  const out: ErrorFlashRect[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
    if (!error.rects) continue;
    const { grid } = error;
    for (const { x, y, w, h } of error.rects) {
      if (w <= 0 || h <= 0) continue;
      const key = `${x},${y},${w},${h},${grid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x, y, w, h, grid });
    }
  }
  return out;
}

/** The two flashes a view plays. */
export type FlashKind = 'error' | 'commit';

/** One flash to play: the cells and bodies to light, on their grids. */
export interface FlashPlan { cells: GridCellRef[]; rects: ErrorFlashRect[] }

/**
 * The flash policy both views play by. Each kind is latest-wins: a view drops the flash of that kind
 * still fading before it plays the next, so a burst coalesces into one beat and never stacks. An
 * error flash is essential evidence, never suppressed, only gated by `shouldFlashErrors`; a commit
 * flash is decorative confirmation (the cells already show their committed state), so reduced
 * motion skips it. A call that lights nothing plays nothing and leaves the running flash alone.
 */
export class FlashPolicy {
  /** The last error flash played, for the repeat gate. */
  private errorGate: ErrorFlashGate | null = null;

  constructor(private readonly now: () => number) {}

  /** The error flash to play for `errors`, or null when there is nothing to light or the gate keeps quiet. */
  errors(errors: ValidationError[]): FlashPlan | null {
    const cells = resolveErrorFlashCells(errors);
    const rects = resolveErrorFlashRects(errors);
    if (!cells.length && !rects.length) return null;
    const sig = errorFlashSignature(cells, rects);
    const now = this.now();
    if (!shouldFlashErrors(this.errorGate, sig, now, animConfig.flash.errorRepeatCooldownMs)) return null;
    this.errorGate = { sig, at: now };
    return { cells, rects };
  }

  /** The commit flash to play over `sets`, or null under reduced motion or with nothing to light. */
  commit(sets: readonly CellSet[]): FlashPlan | null {
    if (isMotionReduced()) return null;
    const cells = flashCells(sets);
    return cells.length ? { cells, rects: [] } : null;
  }
}
