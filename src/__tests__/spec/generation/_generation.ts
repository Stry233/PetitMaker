/**
 * Generate, Clear and Smart Build as the shelf and the bar run them on a spec world: a run lands
 * through the editor's own Generate verb, a card picture is the candidate the shelf builds, and a
 * map is compared by what stands on it, object ids aside (an id is minted per placement, never drawn
 * from the seed).
 */
import { clearGenerated, generateCandidate, generateMap, type Candidate, type Outcome } from '../../../editor/operations';
import { __resetCandidateCache } from '../../../tools/generation/run/candidates';
import { defaultConfig, type GenerateConfig, type Stencil, type StencilConfig } from '../../../tools/generation/recipe';
import { serialize } from '../../../io/save/json-codec';
import { standingViolations } from '../../../state/relocation-plan';
import { isLandmarkItem } from '../../../core/model/landmarks';
import { objectRect } from '../../../state/object-geometry';
import { isBuildableZone } from '../../../core/game/zones';
import { reportGenerate } from '../../../editor/editing/generate-report';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import type { StencilKind } from '../../../tools/generation/kinds';
import type { GridState, MacroCoord, PlacedObject } from '../../../core/model/types';
import type { EditContext } from '../../../core/commands/edit-context';
import { createGridState } from '../../../core/model/template';
import { createDefaultRegistry } from '../../../rules';
import { detachedContext } from '../../../tools/macros';
import { planetFixture, pondMask } from '../../_support/planet';
import type { SpecWorld } from '../_world';

/** A spec world, or the editor over a map no spec world opens (a custom planet). */
type On = SpecWorld | EditContext;
const kitOf = (on: On): EditContext => ('sandbox' in on ? on.sandbox.kit : on);

/** A maze across the planet: the cheapest whole-planet recipe there is. */
export const maze = (seed: number): GenerateConfig => defaultConfig('maze', { maxElevation: 2, seed });

/** A designed planet at the quiet end of the richness range, the cheapest one to build. */
export const planet = (seed: number): GenerateConfig => defaultConfig('designed', { seed, richness: 0 });

/** A block of `side` cells fully covered, the shape a Letter or Picture stencil reads. */
export function slab(side: number): Stencil {
  return { width: side, height: side, coverage: new Uint8Array(side * side).fill(255), color: new Uint32Array(side * side) };
}

/** A Letter or Picture laid in objects of `catalogId` over `stencil`, its top-left at `origin`. */
export function picture(stencil: Stencil, origin: MacroCoord, catalogId: string, seed = 1): StencilConfig {
  return defaultConfig('stencil', { seed, maxElevation: 1, stencilPlan: { read: 'shape', fill: { kind: 'object', catalogId }, stencil, origin } });
}

/** Run a recipe on the world as clicking its card does, from a cold start (no card built yet). */
export async function generate(
  on: On, config: GenerateConfig, region: MacroCoord[] | null = null, opts: { signal?: AbortSignal; candidate?: Candidate | null } = {},
): Promise<Outcome> {
  return generateMap(kitOf(on), { config, region, ...opts });
}

/** Build a card's picture as the shelf does, without touching the map. */
export async function card(on: On, config: GenerateConfig, region: MacroCoord[] | null = null): Promise<Candidate | null> {
  return generateCandidate(kitOf(on), { config, region });
}

/** Clear generated, bounded by the last run's scope as the menu's Clear is. */
export function clear(on: On): Outcome {
  return clearGenerated(kitOf(on), { region: null });
}

/** A custom planet with an irregular coast and a pond, open in the editor under the map rules. */
export function customPlanet(): EditContext {
  return detachedContext(createGridState(planetFixture({ water: pondMask([[30, 20], [31, 20], [30, 21], [31, 21]]) })), createDefaultRegistry());
}

/** Forget every card built so far, as a fresh page does. */
export const freshPage = (): void => { __resetCandidateCache(); };

/** The whole cells an object's footprint touches. */
function cellsUnder(o: PlacedObject): MacroCoord[] {
  const r = objectRect(o);
  const out: MacroCoord[] = [];
  for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) out.push({ x, y });
  return out;
}

/** The map by value: every cell and every object's place, with object ids left out. */
export function mapValue(state: GridState): string {
  const parsed = JSON.parse(serialize(state)) as { cells: unknown; objects: { id: string }[] };
  const objects = parsed.objects.map(({ id: _id, ...o }) => JSON.stringify(o)).sort();
  return JSON.stringify({ cells: parsed.cells, objects });
}

/** Every cell whose terrain or objects differ between two readings of one map, as "x,y". */
export function changedCells(before: GridState, after: GridState): Set<string> {
  const out = new Set<string>();
  const { width, height } = after.template;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (JSON.stringify(before.cells[y]?.[x]?.terrain ?? null) !== JSON.stringify(after.cells[y]?.[x]?.terrain ?? null)) out.add(`${x},${y}`);
  }
  const mark = (o: PlacedObject): void => { for (const { x, y } of cellsUnder(o)) out.add(`${x},${y}`); };
  const key = (o: PlacedObject): string => JSON.stringify({ ...o, id: undefined });
  const was = new Set([...before.objects.values()].map(key));
  const now = new Set([...after.objects.values()].map(key));
  for (const o of before.objects.values()) if (!now.has(key(o))) mark(o);
  for (const o of after.objects.values()) if (!was.has(key(o))) mark(o);
  return out;
}

/** What the map's rules say about the map as it stands: every post-stroke finding and every object
 *  that a placement where it stands would be refused, by rule id. Empty for a legal map. */
export function ruleFindings(on: On): string[] {
  const { state, registry } = kitOf(on);
  const post = registry.validatePostStroke(state).map((v) => v.ruleId);
  const placed = [...standingViolations(state, registry, [...state.objects.keys()].filter((id) => !isLandmarkItem(id))).values()];
  return [...post, ...placed];
}

/** The landmark objects and the terrain on every cell under them, for comparing before and after. */
export function landmarkGround(state: GridState): string {
  const marks = [...state.objects.values()].filter((o) => isLandmarkItem(o.id));
  const ground: unknown[] = [];
  for (const o of marks) {
    for (const { x, y } of cellsUnder(o)) ground.push(state.cells[y]?.[x]?.terrain ?? null);
  }
  return JSON.stringify({ marks, ground });
}

/** A square of `side` buildable cells clear of the landmark, nearest the planet's west side. */
export function westSquare(state: GridState, side: number): MacroCoord[] {
  const { width, height } = state.template;
  const marks = [...state.objects.values()].filter((o) => isLandmarkItem(o.id)).map((o) => objectRect(o));
  const open = (x: number, y: number): boolean => {
    const c = state.cells[y]?.[x];
    return !!c && isBuildableZone(c.zone) && !marks.some((r) => x >= r.x - 2 && x < r.x + r.w + 2 && y >= r.y - 2 && y < r.y + r.h + 2);
  };
  for (let x0 = 0; x0 + side <= width; x0++) for (let y0 = Math.floor(height / 2 - side / 2); y0 + side <= height; y0++) {
    const cells: MacroCoord[] = [];
    for (let y = y0; y < y0 + side; y++) for (let x = x0; x < x0 + side; x++) if (open(x, y)) cells.push({ x, y });
    if (cells.length === side * side) return cells;
  }
  throw new Error(`no clear ${side}x${side} square on this planet`);
}

/** What the editor tells the visitor once a run has landed, as the shelf reports it: each notice's
 *  text, and whether the run counts as landed. */
export function told(outcome: Outcome, kind: StencilKind | null): { notices: string[]; landed: boolean } {
  const notices: string[] = [];
  const stop = setToastPresenter((text) => { notices.push(text); });
  try {
    return { notices, landed: reportGenerate(outcome, kind) };
  } finally {
    stop();
  }
}
