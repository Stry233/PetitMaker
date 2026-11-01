/**
 * Random editing sessions over the headless editor: a seeded run of the gestures a person makes
 * (strokes, roads, erasing, corner cuts, placements, selection, moves, turns, deletes, copy and
 * paste, layer locks) mixed with undo and redo, every step driven through `SandboxWorld`'s pointer
 * and keys. A run checks the history and file properties as it goes and, on a failure, shrinks the
 * step list to a minimal one that still fails, so the seed and the steps reproduce it.
 */
import { SandboxWorld } from '../../../editor/sandbox/demo-world';
import { mapFingerprint } from '../../../core/model/fingerprint';
import type { GridState, MacroCoord, Rotation } from '../../../core/model/types';
import { ToolType, type BuildShape } from '../../../state/editing/vocabulary';
import { createDefaultRegistry } from '../../../rules';
import { illegalTerrain, isLegalMap, standingViolations } from '../../../state/relocation-plan';
import { serialize } from '../../../io/save/json-codec';
import { openSave } from '../../../io/import/open-save';
import { canonicalize } from '../../../io/save/canonical';
import { spec } from '../../_support/spec';
import { SpecWorld } from '../_world';

/** mulberry32: a small seeded generator, so a seed names one run exactly. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Cell = readonly [number, number];

/** One gesture, as plain data so a failing list prints and replays. A `pick` names, when the step
 *  runs, one of the working area's objects (sorted by position) or, for the eraser and the corner
 *  tool, one of its cells holding terrain or water laid in the session, wrapped; the eraser's path then runs by offsets
 *  from it. Turning, deleting, copying and a
 *  `fresh` paste (copy, then paste) first click their object when nothing is selected. */
export type Step =
  | { k: 'paint'; surface: 'mountain' | 'water'; floor: number; shape: BuildShape; size: number; path: Cell[] }
  | { k: 'road'; material: string; shape: BuildShape; path: Cell[] }
  | { k: 'erase'; pick: number; path: Cell[] }
  | { k: 'cut'; pick: number; corner: Cell }
  | { k: 'place'; item: string; at: Cell; rotation: Rotation }
  | { k: 'select'; pick: number; add: boolean }
  | { k: 'band'; from: Cell; to: Cell }
  | { k: 'move'; pick: number; by: Cell }
  | { k: 'rotate'; pick: number; turn: 90 | -90 }
  | { k: 'delete'; pick: number }
  | { k: 'copy'; pick: number }
  | { k: 'paste'; pick: number; fresh: boolean }
  | { k: 'lock'; floor: number; locked: boolean }
  | { k: 'undo' }
  | { k: 'redo' };

const ITEMS = ['tree-apple', 'tree-fir', 'flower-rose', 'building-bamboo-cabin', 'building-stall', 'ramp-grassy', 'bridge-iron'];
const ROADS = ['path-overgrown-dirt', 'path-blue-board'];
const SHAPES: BuildShape[] = ['free', 'line', 'rect'];
const ROTATIONS: Rotation[] = [0, 90, 180, 270];

/** The patch of open ground a session works on, near the planet's centre, with a rim of whatever
 *  surrounds it so edits also meet sand, the shore and existing terrain. */
interface Area { x0: number; y0: number; size: number }
const AREA_SIZE = 14;
const areas = new Map<string, Area>();
function areaOf(templateId: string): Area {
  let a = areas.get(templateId);
  if (!a) {
    const at = new SpecWorld(templateId).openGround(AREA_SIZE - 4, AREA_SIZE - 4, 1);
    a = { x0: at.x - 2, y0: at.y - 2, size: AREA_SIZE };
    areas.set(templateId, a);
  }
  return a;
}

/** A random list of `length` steps on `templateId`'s working area. */
export function randomSteps(seed: number, length: number, templateId: string): Step[] {
  const r = seeded(seed);
  const a = areaOf(templateId);
  const int = (n: number) => Math.floor(r() * n);
  const of = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const cell = (): Cell => [a.x0 + int(a.size), a.y0 + int(a.size)];
  const near = (c: Cell, reach: number): Cell => [c[0] + int(2 * reach + 1) - reach, c[1] + int(2 * reach + 1) - reach];
  const path = (): Cell[] => {
    const first = cell();
    const out = [first];
    for (let i = int(4); i > 0; i--) out.push(near(out[out.length - 1]!, 3));
    return out;
  };
  const steps: Step[] = [];
  for (let i = 0; i < length; i++) {
    const roll = r();
    let s: Step;
    if (roll < 0.16) s = { k: 'paint', surface: r() < 0.75 ? 'mountain' : 'water', floor: 1 + int(3), shape: of(SHAPES), size: 1 + int(2), path: path() };
    else if (roll < 0.24) s = { k: 'road', material: of(ROADS), shape: of(SHAPES), path: path() };
    else if (roll < 0.30) s = { k: 'erase', pick: int(256), path: path().map(([x, y], _, all) => [x - all[0]![0], y - all[0]![1]] as const) };
    else if (roll < 0.35) s = { k: 'cut', pick: int(256), corner: [of([-0.45, 0.45]), of([-0.45, 0.45])] };
    else if (roll < 0.50) s = { k: 'place', item: of(ITEMS), at: cell(), rotation: of(ROTATIONS) };
    else if (roll < 0.58) s = { k: 'select', pick: int(64), add: r() < 0.3 };
    else if (roll < 0.61) s = { k: 'band', from: cell(), to: cell() };
    else if (roll < 0.67) s = { k: 'move', pick: int(64), by: [int(7) - 3, int(7) - 3] };
    else if (roll < 0.71) s = { k: 'rotate', pick: int(64), turn: r() < 0.5 ? 90 : -90 };
    else if (roll < 0.75) s = { k: 'delete', pick: int(64) };
    else if (roll < 0.78) s = { k: 'copy', pick: int(64) };
    else if (roll < 0.81) s = { k: 'paste', pick: int(64), fresh: r() < 0.6 };
    else if (roll < 0.84) s = { k: 'lock', floor: 1 + int(3), locked: r() < 0.6 };
    else if (roll < 0.94) s = { k: 'undo' };
    else s = { k: 'redo' };
    steps.push(s);
  }
  return steps;
}

/** The point at the centre of terrain cell `c`, the grid the brushes read. */
const terrainPoint = (c: Cell): MacroCoord => ({ x: c[0], y: c[1] });
/** The point at the centre of object-grid cell `c`. */
const objectPoint = (c: Cell): MacroCoord => ({ x: c[0] + 0.5, y: c[1] + 0.5 });

/** An editing session: the sandbox editor and the tool it has up. */
class Session {
  readonly world: SandboxWorld;
  private armed = '';
  private readonly area: Area;
  /** The cells whose terrain came with the planet, as `x,y`. */
  private readonly planetTerrain = new Set<string>();
  constructor(templateId: string) {
    this.world = new SandboxWorld(templateId);
    this.area = areaOf(templateId);
    this.world.state.cells.forEach((row, y) => row.forEach((cell, x) => { if (cell.terrain) this.planetTerrain.add(`${x},${y}`); }));
  }

  private inArea(x: number, y: number): boolean {
    const a = this.area;
    return x >= a.x0 && y >= a.y0 && x < a.x0 + a.size && y < a.y0 + a.size;
  }

  private arm(key: string, patch: Parameters<SandboxWorld['pick']>[0]): void {
    if (this.armed === key) return;
    this.world.pick(patch);
    this.armed = key;
  }

  private sweep(path: readonly Cell[], point: (c: Cell) => MacroCoord): void {
    const [first, ...rest] = path;
    if (!first) return;
    this.world.pressMap(point(first));
    for (const c of rest) this.world.moveMap(point(c));
    this.world.releaseMap(point(rest[rest.length - 1] ?? first));
  }

  /** The object `pick` names: its index in the objects sorted by position, wrapped. */
  private target(pick: number) {
    const objects = [...this.world.state.objects.values()].filter((o) => this.inArea(o.position.x, o.position.y))
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || (a.id < b.id ? -1 : 1));
    return objects.length ? objects[pick % objects.length] : undefined;
  }

  /** The cell `pick` names among the area's cells holding terrain or water laid in this session,
   *  else the area's corner. */
  private terrainCell(pick: number): Cell {
    const held: Cell[] = [];
    this.world.state.cells.forEach((row, y) => row.forEach((cell, x) => { if (cell.terrain && this.inArea(x, y) && !this.planetTerrain.has(`${x},${y}`)) held.push([x, y]); }));
    return held[pick % held.length] ?? [this.area.x0, this.area.y0];
  }

  private hand(): void { this.arm('hand', { tool: ToolType.Hand }); }

  /** With nothing selected, the Hand's click on the object `pick` names, as a person selects
   *  before pressing a key; false when the area holds no object. */
  private selectFirst(pick: number): boolean {
    if (this.world.selectedIds().length > 0) return true;
    const o = this.target(pick);
    if (!o) return false;
    this.hand();
    this.world.pressMap(objectPoint([o.position.x, o.position.y]));
    this.world.releaseMap(objectPoint([o.position.x, o.position.y]));
    return true;
  }

  /** Whether the step is a history step rather than an edit. */
  static isHistory(s: Step): boolean { return s.k === 'undo' || s.k === 'redo'; }

  run(s: Step): void {
    const w = this.world;
    switch (s.k) {
      case 'paint':
        this.arm(`paint:${s.surface}:${s.floor}:${s.shape}:${s.size}`, { tool: ToolType.TerrainBrush, contentType: s.surface, floor: s.floor, shape: s.shape, brushSize: s.size });
        this.sweep(s.path, terrainPoint);
        break;
      case 'road':
        this.arm(`road:${s.material}:${s.shape}`, { tool: ToolType.TerrainBrush, contentType: 'road', shape: s.shape, tileMaterial: s.material, tileMaterialPicked: true });
        this.sweep(s.path, objectPoint);
        break;
      case 'erase': {
        const [x, y] = this.terrainCell(s.pick);
        this.arm('erase', { tool: ToolType.Eraser });
        this.sweep(s.path.map(([dx, dy]) => [x + dx, y + dy] as const), terrainPoint);
        break;
      }
      case 'cut': {
        const [x, y] = this.terrainCell(s.pick);
        const at = { x: x + s.corner[0], y: y + s.corner[1] };
        this.arm('cut', { tool: ToolType.EdgeCut });
        w.pressMap(at);
        w.releaseMap(at);
        break;
      }
      case 'place':
        this.arm(`place:${s.item}:${s.rotation}`, { tool: ToolType.ObjectPlacer, armedItem: s.item, picks: [s.item], placementRotation: s.rotation });
        w.pressMap(objectPoint(s.at));
        w.releaseMap(objectPoint(s.at));
        break;
      case 'select': {
        const o = this.target(s.pick);
        if (!o) break;
        this.hand();
        w.held.multiSelect = s.add;
        w.pressMap(objectPoint([o.position.x, o.position.y]));
        w.releaseMap(objectPoint([o.position.x, o.position.y]));
        w.held.multiSelect = false;
        break;
      }
      case 'band':
        this.hand();
        w.held.multiSelect = true;
        this.sweep([s.from, s.to], objectPoint);
        w.held.multiSelect = false;
        break;
      case 'move': {
        const o = this.target(s.pick);
        if (!o) break;
        this.hand();
        const from: Cell = [o.position.x, o.position.y];
        if (!w.selectedIds().includes(o.id)) { w.pressMap(objectPoint(from)); w.releaseMap(objectPoint(from)); }
        this.sweep([from, [from[0] + s.by[0], from[1] + s.by[1]]], objectPoint);
        break;
      }
      case 'rotate': if (this.selectFirst(s.pick)) w.rotateSelection(s.turn); break;
      case 'delete': if (this.selectFirst(s.pick)) w.deleteSelection(); break;
      case 'copy': if (this.selectFirst(s.pick)) w.copySelection(); break;
      case 'paste':
        if (s.fresh && this.selectFirst(s.pick)) w.copySelection();
        w.pasteKey();
        break;
      case 'lock': {
        const next = new Set(w.state.lockedLayers);
        if (s.locked) next.add(s.floor); else next.delete(s.floor);
        w.state.lockedLayers = next;
        break;
      }
      case 'undo': w.undo(); break;
      case 'redo': w.redo(); break;
    }
  }
}

/** The map the history governs, as one comparable string: cells, objects in id order and plan
 *  notes. Layer locks belong to the session, not the history (`SpecWorld.lockLayer`), so they stay out. */
export function mapKey(state: GridState): string {
  const objects = new Map([...state.objects].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${mapFingerprint({ ...state, objects, lockedLayers: new Set() })}|${JSON.stringify(state.annotations?.items ?? [])}`;
}

/** The map's edit counters: unchanged across a step that changed nothing. */
const versions = (state: GridState): string => `${state.cellsVersion}|${state.objectsVersion}`;

/** What a person sees of a map, runtime ids aside, with its plan notes: what a file must carry. */
const seen = (state: GridState): string => `${JSON.stringify(canonicalize(state))}|${JSON.stringify(state.annotations?.items ?? [])}`;

/** Where two maps differ, in a line: the first cells and objects that do not match. */
function difference(a: GridState, b: GridState): string {
  const cells: string[] = [];
  for (let y = 0; y < a.cells.length && cells.length < 4; y++) {
    for (let x = 0; x < (a.cells[y]?.length ?? 0) && cells.length < 4; x++) {
      const ca = JSON.stringify(a.cells[y]![x]), cb = JSON.stringify(b.cells[y]?.[x]);
      if (ca !== cb) cells.push(`(${x},${y}) ${ca} vs ${cb}`);
    }
  }
  const obj = (s: GridState) => new Map([...s.objects.values()].map((o) => [o.id, JSON.stringify(o)]));
  const oa = obj(a), ob = obj(b);
  const objects = [...new Set([...oa.keys(), ...ob.keys()])].filter((id) => oa.get(id) !== ob.get(id)).slice(0, 4)
    .map((id) => `${id}: ${oa.get(id) ?? 'absent'} vs ${ob.get(id) ?? 'absent'}`);
  const notes = JSON.stringify(a.annotations?.items ?? []) === JSON.stringify(b.annotations?.items ?? []) ? [] : ['plan notes differ'];
  return [...cells, ...objects, ...notes].join('; ') || 'no visible difference';
}

/** Why the rules refuse `state`, or null when every rule accepts it (`relocation-plan.ts:isLegalMap`). */
function illegality(state: GridState): string | null {
  const rules = createDefaultRegistry();
  if (isLegalMap(state, rules)) return null;
  const post = rules.validatePostStroke(state).map((v) => `${v.ruleId} at ${v.cells.slice(0, 3).map((c) => `${c.x},${c.y}`).join(' ')}`);
  const terrain = illegalTerrain(state, rules).slice(0, 4).map((c) => `${c.x},${c.y}`);
  const unlocked = [...state.objects.values()].filter((o) => !o.locked).map((o) => o.id);
  const objects = [...standingViolations(state, rules, unlocked)].slice(0, 4)
    .map(([id, rule]) => `${state.objects.get(id)!.catalogId} ${id} at ${state.objects.get(id)!.position.x},${state.objects.get(id)!.position.y} (${rule})`);
  return [
    post.length ? `post-stroke: ${post.join(', ')}` : '',
    terrain.length ? `terrain refused at ${terrain.join(' ')}` : '',
    objects.length ? `objects: ${objects.join(', ')}` : '',
  ].filter(Boolean).join('; ');
}

export type Property = 'undo-to-start' | 'undo-redo' | 'save-load' | 'legal';

export interface Failure { property: Property; step: number; detail: string }

/** The map after playing `steps` on a fresh `templateId` map. */
function replay(templateId: string, steps: readonly Step[]): GridState {
  const s = new Session(templateId);
  for (const step of steps) s.run(step);
  return s.world.state;
}

/** Plays `steps` on a fresh `templateId` map and checks every property, or only `only` as shrinking
 *  a failure of it does; the first failure of each property, in the order found. */
export function check(templateId: string, steps: readonly Step[], only?: Property): Failure[] {
  const failures = new Map<Property, Failure>();
  const want = (p: Property) => (!only || only === p) && !failures.has(p);
  const fail = (property: Property, step: number, detail: string) => { failures.set(property, { property, step, detail }); };
  const s = new Session(templateId);
  const state = s.world.state;
  const startKey = mapKey(state);
  if (want('legal')) {
    const bad = illegality(state);
    if (bad) fail('legal', -1, `the fresh map: ${bad}`);
  }
  let beforeKey = startKey;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const version = versions(state);
    s.run(step);
    // A step that bumps no version changed nothing; the end checks compare content in full.
    if (versions(state) === version) continue;
    const afterKey = mapKey(state);
    if (afterKey === beforeKey) continue;
    if (want('legal')) {
      const bad = illegality(state);
      if (bad) fail('legal', i, bad);
    }
    if (want('undo-redo') && !Session.isHistory(step)) {
      s.world.undo();
      if (mapKey(state) !== beforeKey) fail('undo-redo', i, `undo did not give back the map before the step: ${difference(replay(templateId, steps.slice(0, i)), state)}`);
      else {
        s.world.redo();
        if (mapKey(state) !== afterKey) fail('undo-redo', i, `redo did not bring back the step: ${difference(replay(templateId, steps.slice(0, i + 1)), state)}`);
      }
    }
    beforeKey = afterKey;
  }
  if (want('save-load')) {
    const opened = openSave(serialize(state), state.template);
    if (seen(opened) !== seen(state)) fail('save-load', steps.length, `the opened map differs: ${difference(state, opened)}`);
    else {
      const bad = illegality(opened);
      if (bad) fail('save-load', steps.length, `the opened map breaks the rules: ${bad}`);
    }
  }
  if (want('undo-to-start')) {
    s.world.pick({});
    let guard = 0;
    while (s.world.undo() && guard++ < 10_000);
    if (mapKey(state) !== startKey) fail('undo-to-start', steps.length, `undoing every step left: ${difference(replay(templateId, []), state)}`);
  }
  return [...failures.values()];
}

/** The shortest sublist of `steps` found that still fails `property` (delta debugging over
 *  contiguous chunks, then single steps). */
export function shrink(templateId: string, steps: readonly Step[], property: Property): Step[] {
  let current = [...steps];
  for (let chunk = Math.max(1, Math.floor(current.length / 2)); chunk >= 1; chunk = Math.floor(chunk / 2)) {
    let i = 0;
    while (i < current.length) {
      const candidate = [...current.slice(0, i), ...current.slice(i + chunk)];
      if (candidate.length < current.length && check(templateId, candidate, property).length > 0) current = candidate;
      else i += chunk;
    }
    if (chunk === 1) break;
  }
  return current;
}

/** Runs `count` random sessions of `length` steps from `firstSeed`, the templates taken in turn,
 *  and reports each failure by property: the seed, the minimal step list and what broke. */
export function sessions(opts: { firstSeed: number; count: number; length: number; templates: readonly string[] }): Record<Property, string[]> {
  const reports: Record<Property, string[]> = { 'undo-to-start': [], 'undo-redo': [], 'save-load': [], legal: [] };
  for (let n = 0; n < opts.count; n++) {
    const seed = opts.firstSeed + n;
    const templateId = opts.templates[n % opts.templates.length]!;
    const steps = randomSteps(seed, opts.length, templateId);
    for (const failed of check(templateId, steps)) {
      const minimal = shrink(templateId, steps, failed.property);
      const again = check(templateId, minimal, failed.property)[0] ?? failed;
      reports[failed.property].push([
        `seed ${seed} on ${templateId}: ${failed.property} failed at step ${again.step}: ${again.detail}`,
        `minimal steps (${minimal.length} of ${steps.length}):`,
        ...minimal.map((st, i) => `  ${i}. ${JSON.stringify(st)}`),
      ].join('\n'));
    }
  }
  return reports;
}

/** The four properties as tests over one batch of sessions, run once when the first test asks. */
export function sessionProperties(
  opts: { firstSeed: number; count: number; length: number; templates: readonly string[] },
  declare: (property: Property, failures: () => readonly string[]) => void,
): void {
  let reports: Record<Property, string[]> | null = null;
  for (const p of ['undo-to-start', 'undo-redo', 'save-load', 'legal'] as const) declare(p, () => (reports ??= sessions(opts))[p]);
}

/** Declares the test of `property`, titled by the requirement it proves. */
export function declareSessionProperty(property: Property, run: () => void, timeout?: number): void {
  switch (property) {
    case 'undo-to-start': spec('EDIT-21', 'undoing every step of a random session gives back the map it started from', run, timeout); break;
    case 'undo-redo': spec('EDIT-22', 'at every step of a random session, undo then redo gives back exactly the map after the step', run, timeout); break;
    case 'save-load': spec('PLAN-27', 'a map saved after a random session opens as the same map, legal under the rules', run, timeout); break;
    case 'legal': spec('EDIT-75', 'every edit a random session makes leaves a map every rule accepts', run, timeout); break;
  }
}
