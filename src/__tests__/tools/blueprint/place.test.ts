/** Laying a blueprint body on a map: it lands on the surface under it, stacks its rises on that
 *  surface, and only ever raises what is there. */
import { describe, expect, it } from 'vitest';
import { captureBlueprint, placeBlueprint, previewBlueprint, turnBody, type BlueprintBody } from '../../../tools/blueprint';
import { ELEVATION_MAX } from '../../../core/game/profile';
import { trimRoadCommand, trimTerrainCommand } from '../../../core/model/command-build';
import { isBuildableZone } from '../../../core/game/zones';
import { isLegalMap } from '../../../rules/legality';
import { getCatalogItem } from '../../../state/catalog';
import type { MacroCoord, PlacedObject, TerrainCell } from '../../../core/model/types';
import { rect, TerrainType, world, type SpecWorld } from '../../spec/_world';
import { placeItem, plateau } from '../../spec/editing/_editing';
import { cloneGridState } from '../../../core/model/grid-model';
import { createPlanetRegistry } from '../../../rules';
import type { RuleDispatcher } from '../../../core/model/rule-dispatcher';
import type { PasteDoor } from '../../../tools/objects';

const ROAD = 'path-blue-board';
const STALL = 'building-stall';
const RAMP = 'ramp-grassy';
const TREE = 'tree-apple';
const CABIN = 'building-bamboo-cabin';

const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });

/** Lay `item` with its footprint's top-left at `c`: a ramp as a click aims it, anything else placed
 *  directly. */
function put(w: SpecWorld, item: string, c: MacroCoord): PlacedObject {
  if (item === RAMP) {
    const o = placeItem(w, item, c);
    if (!o) throw new Error(`${item} refused at ${c.x},${c.y}`);
    return o;
  }
  const out = w.place(item, c.x, c.y);
  if (!out.ok) throw new Error(`${item} refused at ${c.x},${c.y}: ${out.refusedBy.join(', ')}`);
  return w.object(out.id!)!;
}

/** A 12 by 12 body: a one-layer plateau with a stall on it and a ramp down its east side, and a
 *  road on the ground beside it. */
function sampleBody(): BlueprintBody {
  const w = world();
  const at = w.openGround(12, 12);
  const top = shift(at, 2, 2);
  plateau(w, top, 6, 6, 1);
  put(w, STALL, shift(top, 1, 1));
  put(w, RAMP, shift(top, 5, 2));
  put(w, ROAD, shift(at, 2, 10));
  const out = captureBlueprint(w.state, { x: at.x, y: at.y, w: 12, h: 12 });
  if (!('body' in out)) throw new Error(`refused: ${out.refusal}`);
  return out.body;
}

/** Every pre-existing object and every terrain cell that held terrain, as they stand. */
function existing(w: SpecWorld): { objects: PlacedObject[]; terrain: Map<string, unknown> } {
  const terrain = new Map<string, unknown>();
  w.state.cells.forEach((row, y) => row.forEach((cell, x) => {
    if (cell.terrain) terrain.set(`${x},${y}`, structuredClone(cell.terrain));
  }));
  return { objects: [...w.state.objects.values()].map((o) => structuredClone(o)), terrain };
}

/** Build every cell of `cells` up to `elevation`, a layer per stroke. */
function raise(w: SpecWorld, cells: readonly MacroCoord[], elevation: number): void {
  for (let e = 1; e <= elevation; e++) {
    const out = w.stroke(cells, TerrainType.Mountain, e);
    if (!out.ok) throw new Error(`layer ${e} refused: ${out.refusedBy.join(', ')}`);
  }
}

/** A frame-sized capture of a stall standing on a flat plateau: the stall at rise 0 on null ground. */
function flatStall(): BlueprintBody {
  const source = world();
  const f = source.openGround(8, 8);
  plateau(source, f, 8, 8, 1);
  put(source, STALL, shift(f, 2, 2));
  const flat = captureBlueprint(source.state, { x: f.x + 1, y: f.y + 1, w: 5, h: 5 });
  if (!('body' in flat)) throw new Error('refused');
  return flat.body;
}

/** The terrain of every cell that holds some, as it stands. */
function terrainOf(w: SpecWorld): Map<string, TerrainCell> {
  const out = new Map<string, TerrainCell>();
  w.state.cells.forEach((row, y) => row.forEach((cell, x) => { if (cell.terrain) out.set(`${x},${y}`, structuredClone(cell.terrain)); }));
  return out;
}

/** A capture of a 2 by 2 pond dug into open ground, centred in a 5 by 5 frame. */
function pond(): BlueprintBody {
  const source = world();
  const f = source.openGround(8, 8);
  if (!source.stroke(rect(shift(f, 3, 3), 2, 2), TerrainType.Water, 0).ok) throw new Error('pond refused');
  const out = captureBlueprint(source.state, { x: f.x + 1, y: f.y + 1, w: 5, h: 5 });
  if (!('body' in out)) throw new Error('refused');
  return out.body;
}

const laidOf = (w: SpecWorld, placed: readonly string[], item: string): PlacedObject =>
  placed.map((id) => w.object(id)!).find((o) => o.catalogId === item)!;

describe('placeBlueprint', () => {
  it('drops on bare ground as before', () => {
    const body = sampleBody();
    const w = world();
    const at = w.openGround(14, 14);
    expect(previewBlueprint(w.sandbox.door(), body, { at, quarters: 0 }).base).toBe(0);
    const res = placeBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(res.skips).toEqual({ ground: 0, objects: 0, capped: 0, unknown: 0 });
    expect(res.placed).toHaveLength(body.objects.length);
    expect(w.terrainAt(shift(at, 4, 4))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    const stall = laidOf(w, res.placed, STALL);
    expect(stall.position).toEqual(shift(at, 3, 3));
    expect(stall.elevation).toBe(1);
    expect(laidOf(w, res.placed, ROAD).elevation).toBe(0);
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it('stacks rises on an elevation-1 plain', () => {
    const body = sampleBody();
    const w = world();
    const g = w.openGround(18, 18);
    raise(w, rect(g, 18, 18), 1);
    const at = shift(g, 2, 2);
    expect(previewBlueprint(w.sandbox.door(), body, { at, quarters: 0 }).base).toBe(1);
    const res = placeBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(res.skips).toEqual({ ground: 0, objects: 0, capped: 0, unknown: 0 });
    // The body's one-tier plateau stands one above the plain; what stood on its ground stands on the plain.
    expect(w.terrainAt(shift(at, 4, 4))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect(w.terrainAt(shift(at, 0, 0))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(laidOf(w, res.placed, STALL).elevation).toBe(2);
    expect(laidOf(w, res.placed, ROAD).elevation).toBe(1);
    expect(laidOf(w, res.placed, RAMP).elevation).toBe(2);
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);

    // A capture of a stall on flat ground lands on the plain's top.
    const v = world();
    const h = v.openGround(10, 10);
    raise(v, rect(h, 10, 10), 1);
    const onTop = placeBlueprint(v.sandbox.door(), flatStall(), { at: shift(h, 2, 2), quarters: 0 });
    expect(onTop.placed).toHaveLength(1);
    expect(v.object(onTop.placed[0]!)!.elevation).toBe(1);
  });

  it('uses the height most of the footprint sits at on uneven ground', () => {
    const body = sampleBody();
    const w = world();
    const g = w.openGround(22, 16);
    // Nine columns of plateau then open ground: a 13-column footprint at g takes nine plateau columns.
    raise(w, rect(g, 9, 16), 1);
    const door = w.sandbox.door();
    expect(previewBlueprint(door, body, { at: shift(g, 0, 1), quarters: 0 }).base).toBe(1);
    expect(previewBlueprint(door, body, { at: shift(g, 4, 1), quarters: 0 }).base).toBe(0);
    // Two cells of each height under a one-cell frame: a tie goes to the lower.
    const tiny: BlueprintBody = { w: 1, h: 1, cells: [null, null, null, null], objects: [{ catalogId: TREE, x: 0, y: 0, rotation: 0, rise: 0 }] };
    expect(previewBlueprint(door, tiny, { at: shift(g, 8, 4), quarters: 0 }).base).toBe(0);

    const res = placeBlueprint(door, body, { at: shift(g, 0, 1), quarters: 0 });
    expect(w.terrainAt(shift(g, 4, 5))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect(laidOf(w, res.placed, STALL).elevation).toBe(2);
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it('fills lower cells up to the base', () => {
    const body = sampleBody();
    const w = world();
    const g = w.openGround(18, 18);
    const at = shift(g, 2, 2);
    // A plain with three pockets of open ground: under the body's plateau, under its road, and where
    // the body holds only ground and nothing stands.
    const pockets = new Set([
      ...rect(shift(at, 4, 4), 1, 1), ...rect(shift(at, 2, 10), 2, 2), ...rect(shift(at, 10, 1), 1, 1),
    ].map((c) => `${c.x},${c.y}`));
    raise(w, rect(g, 18, 18).filter((c) => !pockets.has(`${c.x},${c.y}`)), 1);
    const res = placeBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(w.terrainAt(shift(at, 4, 4))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    for (const c of rect(shift(at, 2, 10), 2, 2)) expect(w.terrainAt(c), `${c.x},${c.y}`).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(laidOf(w, res.placed, ROAD).elevation).toBe(1);
    expect(w.terrainAt(shift(at, 10, 1))).toBeNull();
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it('skips cells higher than the blueprint needs', () => {
    const body = sampleBody();
    const w = world();
    const g = w.openGround(18, 18);
    const at = shift(g, 2, 2);
    raise(w, rect(g, 18, 18), 1);
    // A tower over the body's plateau, which wants 2 there, and one where the body holds only ground.
    raise(w, [shift(at, 2, 7)], 3);
    raise(w, [shift(at, 10, 1)], 2);
    const preview = previewBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(preview.blocked).toEqual([shift(at, 2, 7)]);
    const res = placeBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(res.skips.ground).toBe(1);
    expect(w.terrainAt(shift(at, 2, 7))).toEqual({ type: TerrainType.Mountain, elevation: 3 });
    expect(w.terrainAt(shift(at, 10, 1))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect(w.terrainAt(shift(at, 3, 7))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it('never lowers or reshapes existing terrain', () => {
    const body = sampleBody();
    // Seeded offsets and turns over one rugged patch: plain, towers, a cut block, a pit, a pond and a road.
    let seed = 7;
    const next = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let round = 0; round < 6; round++) {
      const w = world();
      const g = w.openGround(24, 24);
      const pit = shift(g, 9, 9), pond = shift(g, 12, 14);
      raise(w, rect(g, 24, 24).filter((c) => !(c.x === pit.x && c.y === pit.y) && !(c.x === pond.x && c.y === pond.y)), 1);
      raise(w, rect(shift(g, 4, 4), 2, 2), 3);
      raise(w, rect(shift(g, 14, 6), 3, 2), 2);
      expect(w.sandbox.execute(trimTerrainCommand(g.x + 14, g.y + 7, ['square', 'square', 'fan', 'square'])).success).toBe(true);
      expect(w.stroke([pond], TerrainType.Water, 0).ok).toBe(true);
      put(w, ROAD, shift(g, 7, 12));
      put(w, TREE, shift(g, 16, 16));
      const before = terrainOf(w);
      const objects = [...w.state.objects.values()].map((o) => structuredClone(o));

      const quarters = next(4);
      const at = shift(g, next(10), next(10));
      const label = `round ${round} at +${at.x - g.x},+${at.y - g.y} turned ${quarters}`;
      placeBlueprint(w.sandbox.door(), body, { at, quarters });
      const after = terrainOf(w);
      for (const [key, t] of before) {
        const now = after.get(key);
        expect(now, `${label} ${key}`).toBeDefined();
        expect(now!.type, `${label} ${key}`).toBe(t.type);
        expect(now!.elevation, `${label} ${key}`).toBeGreaterThanOrEqual(t.elevation);
        if (now!.elevation === t.elevation) expect(now, `${label} ${key}`).toEqual(t);
      }
      for (const o of objects) expect(w.object(o.id), `${label} ${o.catalogId}`).toEqual(o);
      expect(isLegalMap(w.state, w.sandbox.kit.registry), label).toBe(true);
    }
  });

  it('never removes objects or lowers terrain', () => {
    const body = sampleBody();
    const w = world();
    const at = w.openGround(14, 14);
    plateau(w, shift(at, 3, 3), 2, 2, 2);
    expect(w.terrainAt(shift(at, 3, 3))).toEqual({ type: TerrainType.Mountain, elevation: 2 });
    put(w, TREE, shift(at, 7, 6));
    put(w, ROAD, shift(at, 3, 11));
    expect(w.stroke([shift(at, 10, 10)], TerrainType.Water, 0).ok).toBe(true);
    const before = existing(w);

    const res = placeBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(res.skips.ground + res.skips.objects).toBeGreaterThan(0);
    const after = existing(w);
    for (const o of before.objects) expect(w.object(o.id), o.catalogId).toEqual(o);
    for (const [key, t] of before.terrain) expect(after.terrain.get(key), key).toEqual(t);
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it('leaves the cuts of existing terrain and roads beside it as they were', () => {
    const body = sampleBody();
    const w = world();
    const at = w.openGround(14, 14);
    // A block whose south-west corner is rounded toward the body's plateau, one row above it.
    expect(w.stroke(rect(shift(at, 3, 0), 2, 2), TerrainType.Mountain, 1).ok).toBe(true);
    expect(w.sandbox.execute(trimTerrainCommand(at.x + 3, at.y + 1, ['square', 'square', 'fan', 'square'])).success).toBe(true);
    // A lone road with its east corners cut, west of the body's plateau, and one beside the body's road.
    const road = put(w, ROAD, shift(at, 0, 4));
    const other = put(w, ROAD, shift(at, 1, 10));
    expect(w.sandbox.execute(trimRoadCommand(other, other.position.x, other.position.y, ['square', 'fan', 'square', 'fan'])).success).toBe(true);
    expect(w.sandbox.execute(trimRoadCommand(road, road.position.x, road.position.y, ['square', 'fan', 'square', 'fan'])).success).toBe(true);
    const before = existing(w);

    placeBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    for (const o of before.objects) expect(w.object(o.id), o.catalogId).toEqual(o);
    for (const [key, t] of before.terrain) expect(existing(w).terrain.get(key), key).toEqual(t);
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it('turns an uncut plain block into water at its own height', () => {
    const w = world();
    const g = w.openGround(12, 12);
    raise(w, rect(g, 12, 12), 1);
    const at = shift(g, 3, 3);
    const water = rect(shift(at, 2, 2), 2, 2);
    const preview = previewBlueprint(w.sandbox.door(), pond(), { at, quarters: 0 });
    expect(preview.base).toBe(1);
    expect(preview.blocked).toEqual([]);
    placeBlueprint(w.sandbox.door(), pond(), { at, quarters: 0 });
    for (const c of water) expect(w.terrainAt(c), `${c.x},${c.y}`).toMatchObject({ type: TerrainType.Water, elevation: 1 });
    expect(w.terrainAt(shift(at, 1, 1))).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it('skips and marks a pond cell over a plain block holding an object or a cut', () => {
    for (const blocker of ['object', 'cut'] as const) {
      const w = world();
      const g = w.openGround(12, 12);
      raise(w, rect(g, 12, 12), 1);
      const at = shift(g, 3, 3);
      const target = shift(at, 2, 2);
      if (blocker === 'object') put(w, TREE, target);
      else expect(w.sandbox.execute(trimTerrainCommand(target.x, target.y, ['fan', 'square', 'square', 'square'])).success).toBe(true);
      const held = w.terrainAt(target);
      const preview = previewBlueprint(w.sandbox.door(), pond(), { at, quarters: 0 });
      expect(preview.blocked, blocker).toContainEqual(target);
      expect(preview.cells, blocker).not.toContainEqual(target);
      const res = placeBlueprint(w.sandbox.door(), pond(), { at, quarters: 0 });
      expect(res.skips.ground, blocker).toBeGreaterThan(0);
      expect(w.terrainAt(target), blocker).toEqual(held);
      expect(isLegalMap(w.state, w.sandbox.kit.registry), blocker).toBe(true);
    }
  });

  it('skips cells outside the buildable zone', () => {
    const body = sampleBody();
    const w = world();
    // A frame reaching three cells past the planet's western shore on its middle row.
    const y = Math.floor(w.state.cells.length / 2);
    const shore = w.state.cells[y]!.findIndex((c) => isBuildableZone(c.zone));
    const at = { x: shore - 3, y: y - 6 };
    const res = placeBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(res.skips.ground).toBeGreaterThan(0);
    w.state.cells.forEach((row, cy) => row.forEach((cell, cx) => {
      if (cell.terrain) expect(isBuildableZone(cell.zone) || cell.terrain.type === TerrainType.None, `${cx},${cy}`).toBe(true);
    }));
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it("counts parts left out at an item's limit", () => {
    expect(getCatalogItem(CABIN)?.maxCount).toBe(1);
    const source = world();
    const s = source.openGround(8, 8);
    put(source, CABIN, shift(s, 1, 1));
    const out = captureBlueprint(source.state, { x: s.x, y: s.y, w: 8, h: 8 });
    if (!('body' in out)) throw new Error('refused');

    const w = world();
    const at = w.openGround(10, 10);
    put(w, CABIN, shift(at, 1, 1));
    const elsewhere = w.openGround(10, 10);
    const res = placeBlueprint(w.sandbox.door(), out.body, { at: elsewhere, quarters: 0 });
    expect(res.skips).toEqual({ ground: 0, objects: 0, capped: 1, unknown: 0 });
    expect(res.placed).toHaveLength(0);
  });

  it('skips parts naming unknown catalog items', () => {
    const body: BlueprintBody = {
      w: 4, h: 4, cells: Array.from({ length: 25 }, () => null),
      objects: [
        { catalogId: 'no-such-item', x: 0, y: 0, rotation: 0, rise: 0 },
        { catalogId: TREE, x: 2, y: 2, rotation: 0, rise: 0 },
      ],
    };
    const w = world();
    const res = placeBlueprint(w.sandbox.door(), body, { at: w.openGround(6, 6), quarters: 0 });
    expect(res.skips).toEqual({ ground: 0, objects: 0, capped: 0, unknown: 1 });
    expect(res.placed.map((id) => w.object(id)!.catalogId)).toEqual([TREE]);
  });

  it('places a turned body legally', () => {
    const body = sampleBody();
    for (const quarters of [1, 2, 3]) {
      const w = world();
      const at = w.openGround(14, 14);
      const res = placeBlueprint(w.sandbox.door(), body, { at, quarters });
      expect(res.skips, `quarters ${quarters}`).toEqual({ ground: 0, objects: 0, capped: 0, unknown: 0 });
      const ramp = res.placed.map((id) => w.object(id)!).find((o) => o.catalogId === RAMP);
      expect(ramp, `quarters ${quarters}`).toBeDefined();
      expect(ramp!.rotation, `quarters ${quarters}`).toBe(turnBody(body, quarters).objects.find((o) => o.catalogId === RAMP)!.rotation);
      expect(isLegalMap(w.state, w.sandbox.kit.registry), `quarters ${quarters}`).toBe(true);
    }
  });

  it('is one undo step', () => {
    const body = sampleBody();
    const w = world();
    const g = w.openGround(18, 18);
    raise(w, rect(g, 18, 18), 1);
    const before = w.fingerprint();
    const res = placeBlueprint(w.sandbox.door(), body, { at: shift(g, 2, 2), quarters: 1 });
    expect(res.placed.length).toBeGreaterThan(0);
    expect(w.fingerprint()).not.toBe(before);
    expect(w.undo()).toBe(true);
    expect(w.fingerprint()).toBe(before);
  });

  it('skips layers past the height limit', () => {
    // A stepped pyramid 15 cells across, each ring a layer above the one outside it, dropped on a
    // plain two layers up: its rings reach layers 3 to 9 and its peak would stand a layer past the top.
    const side = 15;
    const cells: BlueprintBody['cells'] = Array.from({ length: side * side }, (_, k) => {
      const i = k % side, j = Math.floor(k / side);
      return { type: TerrainType.Mountain, rise: 1 + Math.min(i, j, side - 1 - i, side - 1 - j) };
    });
    const body: BlueprintBody = { w: side - 1, h: side - 1, cells, objects: [] };
    const w = world();
    const g = w.openGround(side + 4, side + 4);
    raise(w, rect(g, side + 4, side + 4), 2);
    const at = shift(g, 2, 2);
    const res = placeBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(res.skips.ground).toBe(1);
    expect(w.terrainAt(shift(at, 7, 7))).toEqual({ type: TerrainType.Mountain, elevation: ELEVATION_MAX });
    expect(w.terrainAt(shift(at, 6, 6))).toEqual({ type: TerrainType.Mountain, elevation: ELEVATION_MAX });
    expect(w.terrainAt(at)).toEqual({ type: TerrainType.Mountain, elevation: 3 });
    expect(isLegalMap(w.state, w.sandbox.kit.registry)).toBe(true);
  });

  it('previews the cells that keep their own terrain without laying anything', () => {
    const body = sampleBody();
    const w = world();
    const at = w.openGround(14, 14);
    // A block two layers up where the body's plateau wants one: higher than it needs, so kept.
    raise(w, rect(shift(at, 4, 4), 2, 2), 2);
    const before = w.fingerprint();
    const preview = previewBlueprint(w.sandbox.door(), body, { at, quarters: 0 });
    expect(w.fingerprint()).toBe(before);
    expect(preview.blocked).toEqual(rect(shift(at, 4, 4), 2, 2));
    expect(preview.cells.length + preview.blocked.length).toBe(body.cells.filter((c) => c !== null).length);
    expect(preview.objects.map((o) => o.catalogId).sort()).toEqual(body.objects.map((o) => o.catalogId).sort());
  });
});

/** A small seeded generator, so a failing run can be replayed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A door onto a fresh copy of `state` under `rules`, which nothing has asked anything of before. */
function freshDoor(state: Parameters<typeof cloneGridState>[0], rules: RuleDispatcher): PasteDoor {
  return { state: cloneGridState(state), registry: rules, execute: () => { throw new Error('a preview lays nothing'); }, beginStroke: () => { throw new Error('a preview lays nothing'); } };
}

describe('previewBlueprint on a map that keeps changing', () => {
  it('reads exactly what a fresh look at the same map reads, cells, heights, red cells and objects, edit after edit', () => {
    const terrain = sampleBody();
    const flat = (() => {
      const v = world();
      const at = v.openGround(6, 6);
      put(v, ROAD, shift(at, 1, 1));
      put(v, ROAD, shift(at, 2, 1));
      put(v, TREE, shift(at, 3, 3));
      const out = captureBlueprint(v.state, { x: at.x, y: at.y, w: 6, h: 6 });
      if (!('body' in out)) throw new Error(`refused: ${out.refusal}`);
      return out.body;
    })();
    // What the runs met, so they are known to have judged red cells and laid terrain at all.
    const met = { red: 0, laid: 0, objects: 0 };
    for (const seed of [1, 2, 3]) {
      const next = rng(seed);
      const w = world();
      const g = w.openGround(30, 30);
      const cells = rect(g, 30, 30);
      const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;
      const rules = [w.sandbox.door().registry, createPlanetRegistry()];
      for (let step = 0; step < 30; step++) {
        const roll = next();
        if (roll < 0.35) {
          const c = pick(cells);
          w.stroke(rect(c, 2, 2), TerrainType.Mountain, 1 + Math.floor(next() * 3));
        } else if (roll < 0.6) {
          const c = pick(cells);
          w.place(pick([ROAD, TREE]), c.x, c.y);
        } else if (roll < 0.75) {
          const ids = [...w.state.objects.keys()];
          if (ids.length > 0) w.remove(pick(ids));
        } else if (roll < 0.85) {
          w.undo();
        }
        for (const body of [terrain, flat]) {
          const at = shift(pick(cells), -2, -2);
          const p = { at, quarters: Math.floor(next() * 4) };
          for (const registry of rules) {
            const live: PasteDoor = { ...w.sandbox.door(), registry };
            const look = previewBlueprint(freshDoor(w.state, registry), body, p);
            met.red += look.blocked.length;
            met.laid += look.cells.length;
            met.objects += look.objects.length;
            const fresh = JSON.stringify(look);
            expect(JSON.stringify(previewBlueprint(live, body, p)), `seed ${seed} step ${step}: first look`).toBe(fresh);
            expect(JSON.stringify(previewBlueprint(live, body, p)), `seed ${seed} step ${step}: second look`).toBe(fresh);
          }
        }
      }
    }
    expect(met.red).toBeGreaterThan(0);
    expect(met.laid).toBeGreaterThan(0);
    expect(met.objects).toBeGreaterThan(0);
  });
});
