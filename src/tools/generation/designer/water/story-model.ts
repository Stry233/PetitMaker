/**
 * The water story's vocabulary: its reaches, falls and pond (the pond's shapes as cell sets), the
 * input a story is carved from, and the direction arithmetic its walk uses.
 */
import type { MacroCoord } from '../../../../core/model/types';
import type { Rect } from '../../../../core/grid/rect';
import type { TerrainPlan } from '../../terrain-plan/types';
import type { MovementLine } from '../composition/movement-line';
import type { DesignPlan } from '../types';

export type PondShape = 'lozenge' | 'u-moat' | 'islet' | 'diamond';

/** One run of the course along a single terrace. */
export interface StoryReach {
  tier: number;
  cells: MacroCoord[];
}

/** One fall, cut on the lip of a terrace step. `main` is the course's own; the companions are the
 *  narrower staggered ones beside it. */
export interface StoryFall {
  rect: Rect;
  tier: number;
  /** The level the water lands on: one tier down for a step, further for a plunge. */
  landsAt: number;
  main: boolean;
}

export interface StoryPond {
  shape: PondShape;
  rect: Rect;
  tier: number;
  cells: MacroCoord[];
}

export interface WaterStory {
  source: { at: MacroCoord; tier: number };
  /** The centre of the stream, source to arrival, in flow order: what a contact sheet draws so a
   *  reader can see where the water comes from and where it goes. The pond is its own shape and is
   *  drawn from `pond`, so the spine stays a line. */
  spine: MacroCoord[];
  reaches: StoryReach[];
  falls: StoryFall[];
  pond: StoryPond | null;
  /** Where the course ends. A course that ends nowhere is reverted, so this is never 'dry'. */
  ending: 'pond' | 'sea';
  /** The branch that leaves the course and rejoins it, where one was drawn. */
  tributary: MacroCoord[];
  bays: Rect[];
  /** Every cell the story flooded. */
  cells: MacroCoord[];
}

export interface StoryInput {
  t: TerrainPlan;
  grass: Uint8Array;
  flat: Uint8Array;
  /** The places, so the course narrows where it passes homes and widens into a bay in a park. */
  plan: DesignPlan;
  /** The walk, so the source stands where a visitor climbs rather than on the far side of the map. */
  line?: MovementLine | undefined;
  /**
   * Water already standing that the course should carry on from, where the map has some: the foot of
   * a cascade stair.
   *
   * A stair is the same water story told on a slope, so a course that starts a spring of its own
   * somewhere else leaves the map with two unrelated systems. Offered before the springs and never
   * instead of them — a mouth whose course arrives nowhere is put back like any other attempt.
   */
  mouth?: { at: MacroCoord; tier: number } | undefined;
  richness: number;
  seed: number;
}

export type Vec = readonly [number, number];

export const left = (d: Vec): Vec => [d[1], -d[0]];
export const right = (d: Vec): Vec => [-d[1], d[0]];
export const perp = left;

/** The cross-section of a course of `width` centred at `at`, across `dir`. */
export function section(at: MacroCoord, dir: Vec, width: number): MacroCoord[] {
  const p = perp(dir);
  const lo = (width - 1) >> 1;
  const out: MacroCoord[] = [];
  for (let k = -lo; k <= width - 1 - lo; k++) out.push({ x: at.x + p[0] * k, y: at.y + p[1] * k });
  return out;
}

/** The four pond shapes, as cell sets inside a box. Every one is symmetric about the box's own axes,
 *  which is what makes a pond read as composed rather than as a blob. */
export function pondCells(shape: PondShape, rect: Rect): MacroCoord[] {
  const out: MacroCoord[] = [];
  const cx = (rect.w - 1) / 2, cy = (rect.h - 1) / 2;
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const nx = Math.abs(x - cx) / Math.max(0.5, cx), ny = Math.abs(y - cy) / Math.max(0.5, cy);
      let take: boolean;
      switch (shape) {
        case 'diamond':
        case 'lozenge':
          take = nx + ny <= 1.05;
          break;
        case 'islet':
          // A lozenge with a dry islet standing in the middle of it.
          take = nx + ny <= 1.15 && nx + ny >= 0.45;
          break;
        default:
          // The U-moat: water down two sides and across one end, holding a dry islet.
          take = x === 0 || x === rect.w - 1 || y === rect.h - 1;
          break;
      }
      if (take) out.push({ x: rect.x + x, y: rect.y + y });
    }
  }
  return out;
}
