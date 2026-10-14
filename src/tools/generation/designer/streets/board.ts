/**
 * The board the street stages paint on: the paveable mask, tiers, reserved cells and each cell's
 * paved rank, with the stamp geometry of one run.
 */
import { flatIndex, type Rect } from '../../../../core/grid/rect';
import type { MapTemplate } from '../../../../core/model/types';
import type { CompositionPlan } from '../composition/composition';
import { cellTiers, landBox, landMask, levelWindows, hubCentre, hubRect } from '../planet';
import type { StreetRun } from './model';

export interface Board {
  W: number; H: number;
  /** Buildable planet: the Grass zone. */
  land: Uint8Array;
  /** Plate tier per cell, -1 off the planet. */
  tier: Int8Array;
  /** Cells a road tile may be laid on: the `flat` trait's own window (the cell plus one column right
   *  and one row below) level (`planet.ts:levelWindows`), and clear of the plaza. So the mask
   *  already leaves the one-cell gap before every tier step that a flight exists to cross. */
  pavable: Uint8Array;
  hubArea: Rect;
  hub: { x: number; y: number };
  /** The plaza's own plate (`CompositionPlan.hubPlateId`), 1 per cell. */
  hubPlate: Uint8Array;
  /** The planet's own bounding extent, which a street's run is long or short a share of. */
  extent: { w: number; h: number };
  paved: Uint8Array;
  /** Which street first paved a cell, -1 where none did. */
  owner: Int32Array;
  rankAt: Uint8Array;
  /** Cells a ramp footprint or its cleared corridor holds: pavement may never be laid there. */
  reserved: Uint8Array;
  /** Cells a street may legitimately end at: a live flight's corridor and a crossing's channel, the
   *  two places the way on is a ramp or a deck rather than more pavement. Kept apart from
   *  `reserved`, which also holds the dual-grid margins of retired flights — ground nothing stands
   *  on, and a tail stopping there is a tail stopping at nothing. */
  stopAt: Uint8Array;
}

const RANK_CODE: Record<'trunk' | 'branch', number> = { trunk: 1, branch: 2 };
export const RANK_OF = ['', 'trunk', 'branch'] as const;

export function makeBoard(template: MapTemplate, composition: CompositionPlan): Board {
  const W = template.width, H = template.height, N = W * H;
  const land = landMask(template);
  const tier = new Int8Array(N).fill(-1);
  // The realized field, not the plate's nominal tier: a plate's rim slopes down to the shore, and a
  // street planned on the nominal tier would be laid on ground that comes out lower than it read.
  const realized = cellTiers(template, composition);
  for (let i = 0; i < N; i++) if (land[i]) tier[i] = realized[i]!;
  const hubArea = hubRect(template);
  const box = landBox(land, W, H);
  const extent = box.w > 0 ? { w: box.w, h: box.h } : { w: W, h: H };
  const pavable = levelWindows(template, realized);
  for (let y = Math.max(0, hubArea.y); y < Math.min(H, hubArea.y + hubArea.h); y++) {
    for (let x = Math.max(0, hubArea.x); x < Math.min(W, hubArea.x + hubArea.w); x++) pavable[flatIndex(x, y, W)] = 0;
  }
  const hubPlate = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (composition.plateOf[i] === composition.hubPlateId) hubPlate[i] = 1;
  return {
    W, H, land, tier, pavable, hubArea, extent, hubPlate,
    hub: hubCentre(template),
    paved: new Uint8Array(N), owner: new Int32Array(N).fill(-1),
    rankAt: new Uint8Array(N), reserved: new Uint8Array(N), stopAt: new Uint8Array(N),
  };
}

/** The square a width-`w` street paves when its skeleton stands at `(x, y)`. Odd widths centre on the
 *  skeleton, even ones sit down-right of it, so a 2-wide street reserved at `y` comes out on exactly the
 *  two rows `y` and `y + 1`. */
export function stampOf(x: number, y: number, w: number): Rect {
  const o = (w - 1) >> 1;
  return { x: x - o, y: y - o, w, h: w };
}

/** Whether a width-`w` skeleton may stand at `(x, y)`: its whole stamp is pavable and unreserved. */
export function skeletonLegal(board: Board, x: number, y: number, w: number): boolean {
  const s = stampOf(x, y, w);
  if (s.x < 0 || s.y < 0 || s.x + s.w > board.W || s.y + s.h > board.H) return false;
  for (let cy = s.y; cy < s.y + s.h; cy++) {
    for (let cx = s.x; cx < s.x + s.w; cx++) {
      const i = flatIndex(cx, cy, board.W);
      if (!board.pavable[i] || board.reserved[i]) return false;
    }
  }
  return true;
}

/** Stamps a run's cells onto the board. */
export function paint(board: Board, run: StreetRun, index: number): void {
  for (let t = run.from; t <= run.to; t++) {
    const x = run.axis === 'y' ? run.line : t;
    const y = run.axis === 'y' ? t : run.line;
    const s = stampOf(x, y, run.width);
    for (let cy = s.y; cy < s.y + s.h; cy++) {
      for (let cx = s.x; cx < s.x + s.w; cx++) {
        const i = flatIndex(cx, cy, board.W);
        // A reserved cell is never paved, whoever is stamping. A flight's corridor and a crossing's
        // gap are both taken out of the pavement after the runs were laid, and `restamp` lays every
        // run down again from the list: without this the next pass would pave the corridor back over
        // the ramp standing in it.
        if (board.paved[i] || board.reserved[i]) continue;
        board.paved[i] = 1;
        board.owner[i] = index;
        board.rankAt[i] = RANK_CODE[run.rank];
      }
    }
  }
}

/** Erases the stretch `[from, to]` of a run from the board, leaving cells another run also paved
 *  alone. Used when a flight claims a corridor and when a tail is trimmed. */
export function erase(board: Board, run: StreetRun, index: number, from: number, to: number): void {
  for (let t = from; t <= to; t++) {
    const x = run.axis === 'y' ? run.line : t;
    const y = run.axis === 'y' ? t : run.line;
    const s = stampOf(x, y, run.width);
    for (let cy = s.y; cy < s.y + s.h; cy++) {
      for (let cx = s.x; cx < s.x + s.w; cx++) {
        const i = flatIndex(cx, cy, board.W);
        if (board.owner[i] !== index) continue;
        board.paved[i] = 0; board.owner[i] = -1; board.rankAt[i] = 0;
      }
    }
  }
}

/** The across-coordinate of a run's pavement: the low edge of its stamp. */
export function acrossOf(run: StreetRun): number {
  const s = stampOf(
    run.axis === 'y' ? run.line : run.from, run.axis === 'y' ? run.from : run.line, run.width,
  );
  return run.axis === 'y' ? s.x : s.y;
}

/** The inclusive across-range a run's pavement covers. */
export function acrossSpan(run: StreetRun): [number, number] {
  const lo = acrossOf(run);
  return [lo, lo + run.width - 1];
}

/** The along-coordinates a run's pavement covers: the stamp reaches one cell past the skeleton at
 *  each end, whether the width is odd (centred) or even (down-right of the skeleton). */
export function firstPaved(run: StreetRun): number { return run.from - ((run.width - 1) >> 1); }
export function lastPaved(run: StreetRun): number { return run.to + run.width - 1 - ((run.width - 1) >> 1); }

export function tierAt(board: Board, run: StreetRun, t: number): number {
  const x = run.axis === 'y' ? run.line : t;
  const y = run.axis === 'y' ? t : run.line;
  if (x < 0 || y < 0 || x >= board.W || y >= board.H) return -1;
  return board.tier[flatIndex(x, y, board.W)]!;
}

/** A rect covering the street's whole width across, and `[lo, hi]` along. */
export function alongRect(axis: 'x' | 'y', across: number, width: number, lo: number, hi: number): Rect {
  return axis === 'y'
    ? { x: across, y: lo, w: width, h: hi - lo + 1 }
    : { x: lo, y: across, w: hi - lo + 1, h: width };
}

/** Lays the board out again from a run list: the only writer of the pavement after the first pass. */
export function restamp(board: Board, runs: readonly StreetRun[]): void {
  board.paved.fill(0);
  board.owner.fill(-1);
  board.rankAt.fill(0);
  for (let index = 0; index < runs.length; index++) paint(board, runs[index]!, index);
}
