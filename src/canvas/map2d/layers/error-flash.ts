/**
 * The pure half of the flash overlays (no Pixi/three, unit-testable — same pattern as
 * chunk-cull): resolve validation errors / undo-redo steps to the cells the flash should
 * light, and the shared decay curve. Both renderers import from here.
 */
import type { MacroCoord, PlacedObject, ValidationError } from '../../../core/model/types';
import { getFootprint } from '../../../core/model/grid-model';
import { getPlacedObjectSize } from '../../../state/object-geometry';

/** An error-flash cell resolved to the grid it renders on (`micro` = terrain, −HALF_TILE). */
export interface ErrorFlashCell { x: number; y: number; micro: boolean }

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
/** Identity of one flash: the exact cells on their grids. */
export function errorFlashSignature(cells: ErrorFlashCell[]): string {
  return cells.map((c) => `${c.x},${c.y},${c.micro ? 1 : 0}`).join(';');
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
 * What a `history-applied` (undo/redo) step should flash. An object step flashes each item's
 * footprint on the MACRO grid (no terrain offset); everything else flashes the touched terrain
 * cells on the micro grid. Returns null when there is nothing to flash. Single source shared by
 * both the 2D and 3D renderers (the 3D copy used to inline the footprint loop by hand). */
export function resolveHistoryFlash(
  cells: MacroCoord[], objects: PlacedObject[] | undefined,
): { cells: MacroCoord[]; terrainMode: boolean } | null {
  if (objects && objects.length > 0) {
    const footprint: MacroCoord[] = [];
    for (const o of objects) {
      const { w, h } = getPlacedObjectSize(o);
      footprint.push(...getFootprint(o.position.x, o.position.y, w, h));
    }
    return footprint.length > 0 ? { cells: footprint, terrainMode: false } : null;
  }
  return cells.length > 0 ? { cells, terrainMode: true } : null;
}

export function resolveErrorFlashCells(errors: ValidationError[], defaultMicro: boolean): ErrorFlashCell[] {
  const out: ErrorFlashCell[] = [];
  const seen = new Set<string>();
  for (const error of errors) {
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
