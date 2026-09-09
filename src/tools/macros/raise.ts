/** Local mounds use a seeded outline and nested terraces. A held stroke supplies its original
 *  footing and owned cells so later bursts cannot rebase on their own new height. */
import { ELEVATION_MAX } from '../../core/model/constants';
import { flatIndex } from '../../core/model/grid-model';
import { valueNoise01 } from '../../core/model/noise';
import { CommandType, type AutoEdgeCut, type GridState, type MacroCoord } from '../../core/model/types';
import { applyAutoEdgeCut } from '../edge-cut/auto-edge-cut';
import { circleCells } from '../paint/shapes';
import type { MacroContext } from './context';
import { cellsChanged } from './measure';
import { terraceRings } from './terrace';
import { canBuildAt, isClean, isWaterAt, surfaceAt } from './terrain';
import { TerrainDraft } from './terrain-draft';

/** Cells per unit of outline noise. Around three, so the lumps are the size of a terrace rather than
 *  of the whole mound or of a single cell. */
const OUTLINE_SCALE = 3.2;
/** How far the noise may push the rim in or out, as a fraction of the radius. */
const OUTLINE_AMOUNT = 0.28;

/** How wide a step is, in cells of inset per tier. Two kinds: a landing deep enough for the ramp
 *  rule's 4-deep approach, and a scenic spire's narrower one. Named here rather than shared with the
 *  generator, because these are the MACRO's steps and a change to how an island is composed must not
 *  silently re-shape a user's press. */
export const WIDE_INSET = 4;
export const STEEP_INSET = 2;

export type RaiseSteepness = 'wide' | 'steep';

export function insetFor(steepness: RaiseSteepness): number {
  return steepness === 'wide' ? WIDE_INSET : STEEP_INSET;
}

/** The top of the ladder: the map's own ceiling, reached by a hold that keeps holding. */
export const LADDER_TOP = ELEVATION_MAX;

/** The tier a rung reaches. Rung 1 is the mound a tap lays, rung 2 the flat top the support rule
 *  still exempts, and every rung after it one nested terrace more. */
export function ladderPeak(stage: number): number {
  return Math.min(LADDER_TOP, Math.max(1, stage) + 1);
}

export interface RaiseInput {
  at: MacroCoord;
  radius: number;
  /** Which rung this burst builds. 1 is a tap. */
  stage: number;
  steepness: RaiseSteepness;
  /** Flat indices earlier bursts of this hold raised. Empty on a tap. */
  held: ReadonlySet<number>;
  /** The level the whole hold measured at its anchor (`raiseFooting`), or absent to read the ground
   *  here and now. A HOLD MUST PASS IT: by its second burst the ground under the disc IS the mound,
   *  so a footing re-read per burst climbs with the mass, and a ladder that re-bases on its own top
   *  never terraces and admits the neighbouring relief a rung at a time. */
  footing?: number;
  seed: number;
  region?: readonly MacroCoord[];
  trim?: AutoEdgeCut;
}

export interface RaiseResult {
  changed: number;
  /** The tier this ground could carry, at or below the rung asked for. The ghost reports it and the
   *  hold stops climbing at it. */
  peak: number;
  /** Cells the mass wanted and the map refused: an object's footprint, a locked layer, ground the zone
   *  will not take. Reported rather than taken silently. */
  blocked: MacroCoord[];
}

/** A footprint cell and the elevation the rings put it at. */
interface Planned { c: MacroCoord; target: number }

export function raiseTerrain(ctx: MacroContext, input: RaiseInput): RaiseResult {
  const { state, executor } = ctx;
  const laid = cellsChanged(state);
  const { at, radius, stage, steepness, held, seed } = input;
  const { width: W, height: H } = state.template;

  const footing = input.footing ?? raiseFooting(state, at, radius);
  const bounds = new TerrainDraft(ctx, input.region);
  const wanted = footprint(state, at, radius, footing, held, seed, W);
  const base = wanted.filter(c => bounds.editable(c, footing + 1) && !isWaterAt(state, c.x, c.y));
  const refused = wanted.filter(c => !bounds.editable(c, footing + 1));
  // What the map has left above the footing. A ladder that would push past the ceiling stops there
  // rather than repainting one tier under a new name.
  const room = ELEVATION_MAX - footing;
  const rings = room > 0
    ? terraceRings({ base, peak: Math.min(ladderPeak(stage), room), inset: insetFor(steepness), width: W, height: H })
    : [];
  if (rings.length === 0) return { changed: laid(), peak: 0, blocked: refused };

  const plan = planOf(rings, footing, W);
  const mark = executor.getUndoStackSize();
  let ceiling = 0;
  for (const p of plan) ceiling = Math.max(ceiling, p.target);
  while (ceiling >= 1) {
    if (paintPlan(ctx, plan, ceiling, input.region)) break;
    // The mass as a whole is illegal, so it loses its top LEVEL and is offered again. The rings are
    // legal by construction, so this turns only on what the geometry does not speak for: a footing
    // standing proud of the ground around it (the rim owes V-MTN-03 a base the map does not have),
    // an object that arrived mid-hold, a locked layer, water the rise would strand. The ceiling is
    // an absolute elevation rather than a ring, because a rise on high ground is refused for how
    // tall it stands on the map, not for how far it rose.
    executor.rollbackTo(mark);
    ceiling--;
  }

  if (input.trim && input.trim !== 'off') {
    const trimMark = executor.getUndoStackSize();
    applyAutoEdgeCut({ gridState: state, executeCommand: cmd => {
      const cells = cmd.type === CommandType.TrimCorners ? [{ x: cmd.x, y: cmd.y }]
        : cmd.type === CommandType.PaintTerrain ? cmd.cells : [];
      if (cells.some(c => !bounds.editable(c))) return { success: false, errors: [] };
      return executor.execute(cmd);
    } }, input.trim, plan.map(p => p.c), []);
    if (!isClean(ctx)) executor.rollbackTo(trimMark);
  }

  // A run that kept NOTHING still names the ground it wanted: a ghost with no gains and no losses
  // says nothing at all about a press that will lay nothing.
  const kept = Math.max(1, ceiling);
  const blocked = [...refused, ...plan.filter((p) => surfaceAt(state, p.c.x, p.c.y) < Math.min(p.target, kept)).map((p) => p.c)];
  let peak = 0;
  for (const p of plan) peak = Math.max(peak, surfaceAt(state, p.c.x, p.c.y) - footing);
  return { changed: laid(), peak, blocked };
}

/**
 * The level a rise sits on: the median surface under the disc, so it rests on the ground it mostly
 * covers rather than on whichever cell the pointer happened to be over.
 *
 * A HOLD READS IT ONCE, AT ITS ANCHOR, and hands the answer to every burst (`RaiseInput.footing`).
 * There is nothing on the map a later burst could read it back off: the ground under the disc by
 * then is the mound, and no measurement can tell the two apart.
 */
export function raiseFooting(state: GridState, at: MacroCoord, radius: number): number {
  const surfaces: number[] = [];
  for (const c of circleCells(at, radius, radius)) {
    if (canBuildAt(state, c.x, c.y)) surfaces.push(surfaceAt(state, c.x, c.y));
  }
  if (surfaces.length === 0) return 0;
  surfaces.sort((a, b) => a - b);
  return surfaces[surfaces.length >> 1]!;
}

/**
 * The cells this rise may raise: the noisy disc, minus everything it must not touch.
 *
 * A cell joins when it is buildable ground standing no higher than the footing, or when this hold
 * raised it itself. Everything else is simply absent, and `terraceRings` erodes from the set's own
 * boundary, so a hand-built mountain inside the disc is a hole the summit steps around.
 */
function footprint(
  state: GridState, at: MacroCoord, radius: number, footing: number,
  held: ReadonlySet<number>, seed: number, W: number,
): MacroCoord[] {
  const noise = valueNoise01((seed ^ 0x4d0e91) >>> 0);
  const cells: MacroCoord[] = [];
  for (const c of circleCells(at, radius, radius)) {
    if (!canBuildAt(state, c.x, c.y)) continue;
    // The rim is pushed in and out by the noise, so what the dial sets is the mound's size and what
    // the seed sets is its shape.
    const wobble = 1 + OUTLINE_AMOUNT * (noise(c.x / OUTLINE_SCALE, c.y / OUTLINE_SCALE) - 0.5) * 2;
    if (Math.hypot(c.x - at.x, c.y - at.y) * wobble >= radius) continue;
    if (surfaceAt(state, c.x, c.y) > footing && !held.has(flatIndex(c.x, c.y, W))) continue;
    cells.push(c);
  }
  return cells;
}

/** The rings as one target elevation per cell. They are cumulative and ascending, so the last ring
 *  that claims a cell is the highest one. */
function planOf(rings: readonly { tier: number; cells: MacroCoord[] }[], footing: number, W: number): Planned[] {
  const byCell = new Map<number, Planned>();
  for (const ring of rings) {
    for (const c of ring.cells) byCell.set(flatIndex(c.x, c.y, W), { c, target: footing + ring.tier });
  }
  return [...byCell.values()];
}

/** Support and placement are validated as a complete draft before accepting a height. */
function paintPlan(ctx: MacroContext, plan: Planned[], ceiling: number, region?: readonly MacroCoord[]): boolean {
  const draft = new TerrainDraft(ctx, region);
  for (const p of plan) draft.raise(p.c, Math.min(p.target, ceiling));
  return draft.commit();
}
