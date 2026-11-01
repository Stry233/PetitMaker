/**
 * The game's rule cases as the released editor judges them, one row each: a small map on a built-in
 * planet, one action through the editor's own path, and the verdict it reaches (taken, or refused by
 * exactly the rules named). The verdicts were recorded from the editor, not reasoned from the rules,
 * so a rule change that alters any of them fails here.
 */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type Outcome, type SpecWorld } from '../_world';
import { build, findCell, groundAt, inStroke, move, peel, PlanetWorld, placed, run, setLayerLocked, turn } from './_rules';
import { eraseTerrainCommand, placeObjectCommand, trimTerrainCommand } from '../../../core/model/command-build';
import { CHUNK_LOAD_LIMIT, CHUNK_SIZE } from '../../../core/game/profile';
import { GRASS_ZONE, isSeaZone, OFF_MAP_ZONE, SAND_ZONE } from '../../../core/game/zones';
import { mapChunkOrigin } from '../../../core/grid/map-chunks';
import { cellKey } from '../../../core/grid/rect';
import { createGridState } from '../../../core/model/template';
import type { Corners, GridState, MacroCoord, Rotation } from '../../../core/model/types';
import { getMapTemplate } from '../../../config/maps';
import { createPlanetRegistry } from '../../../rules/index';
import { getCatalogItem } from '../../../state/catalog';
import { createExecutor } from '../../../state/executor';
import { placeItem } from '../editing/_editing';
import { buildObjectOccupancy } from '../../../state/object-geometry';
import { candidateObject } from '../../../tools/objects';
import { groundCommand } from '../../../tools/placement/ground-command';

const M = TerrainType.Mountain;
const W = TerrainType.Water;
const HOUSE = 'building-bamboo-cabin';
const OTHER_HOUSE = 'building-boat-cabin';
const TREE = 'tree-apple';
const FLOWER = 'flower-protea';
const ROAD = 'path-blue-board';
const PLANTABLE_ROAD = 'path-tilled-soil';

/** Taken, or refused by exactly these rules. */
type Verdict = 'accepted' | readonly string[];

/** A map arranged for one case: what the case does to it, and what the map must hold afterwards. */
interface Trial {
  readonly w: { readonly state: GridState };
  readonly act: () => Outcome;
  readonly after?: () => void;
}

interface GameCase {
  readonly rule: string;
  readonly title: string;
  readonly verdict: Verdict;
  readonly arrange: () => Trial;
}

/** What a fresh planet finds for `key`: every case starts from the same built-in map, so a search
 *  over it runs once. Only for searches on a world no case has changed yet. */
const found = new Map<string, MacroCoord>();
function cellWhere(key: string, w: SpecWorld, pred: (x: number, y: number) => boolean): MacroCoord {
  let at = found.get(key);
  if (!at) { at = findCell(w, pred); found.set(key, at); }
  return at;
}
const spot = (w: SpecWorld, width: number, height: number, margin = 2): MacroCoord => {
  const key = `open-${width}x${height}+${margin}`;
  let at = found.get(key);
  if (!at) { at = w.openGround(width, height, margin); found.set(key, at); }
  return at;
};

/** Everything a person sees of the map (ground, terrain, objects, locks), as one comparable string. */
function snapshot(s: GridState): string {
  const objects = [...s.objects.values()].map((o) => JSON.stringify(o)).sort();
  const cells = s.cells.map((row) => row.map((c) => `${c.zone}${c.under ?? ''}${c.terrain ? JSON.stringify(c.terrain) : ''}`).join(',')).join(';');
  return JSON.stringify([objects, cells, [...s.lockedLayers].sort(), s.ignoreChunkLoad ?? false]);
}

const verdictOf = (o: Outcome): Verdict => (o.ok ? 'accepted' : [...o.refusedBy].sort());

const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });
const landmarkOf = (w: SpecWorld) => [...w.state.objects.values()].find((o) => o.locked)!;
const openGrass = (w: SpecWorld) => {
  const occupied = buildObjectOccupancy(w.state);
  return (x: number, y: number): boolean => groundAt(w, x, y) === GRASS_ZONE && !w.terrainAt({ x, y }) && !occupied.has(cellKey(x, y));
};

/** A plateau one level up with a single ramp snapped onto its south cliff; the ramp's anchor. */
function ramped(w: SpecWorld): MacroCoord {
  const at = spot(w, 6, 9);
  build(w, [rect(at, 6, 6), M, 1]);
  return placed(w, 'ramp-grassy', at.x + 2, at.y + 6).position;
}

/** A house standing one level up at the top-left of a 6-wide plateau `depth` rows deep. */
function raisedHouse(depth: number, notch?: (at: MacroCoord) => MacroCoord): Trial {
  const w = world();
  const at = spot(w, 6, 9);
  const top = rect(at, 6, depth).filter((c) => !notch || cellKey(c.x, c.y) !== cellKey(notch(at).x, notch(at).y));
  build(w, [top, M, 1]);
  return { w, act: () => w.place(HOUSE, at.x, at.y, { elevation: 1 }) };
}

/** A house on grass whose door side has `rows` rows of grass before the sea. */
function houseBeforeSea(rows: number): Trial {
  const w = world();
  const open = openGrass(w);
  const sea = (x: number, y: number): boolean => { const cell = w.state.cells[y]?.[x]; return !!cell && isSeaZone(cell.zone); };
  const at = cellWhere(`sea-${rows}`, w, (x, y) => rect({ x: x - 1, y: y + 5 + rows }, 8, 1).every((c) => sea(c.x, c.y))
    && rect({ x: x - 1, y: y - 1 }, 8, 6 + rows).every((c) => open(c.x, c.y)));
  return { w, act: () => w.place(HOUSE, at.x, at.y) };
}

/** The planet editor's world laid out so grass runs to the map's top edge, a house placed there
 *  turned to face the edge with `rows` rows of grass before it. */
function houseBeforeMapEdge(rows: number): Trial {
  const state = createGridState(getMapTemplate(undefined));
  const executor = createExecutor(state, createPlanetRegistry());
  const x = Math.floor((state.cells[0]?.length ?? 0) / 2) - 3;
  const ground = executor.execute(groundCommand(rect({ x: x - 2, y: 0 }, 10, 12), GRASS_ZONE));
  if (!ground.success) throw new Error('arranging grass to the edge was refused');
  const act = (): Outcome => {
    const rotation: Rotation = 180;
    const candidate = candidateObject(getCatalogItem(HOUSE)!, { x, y: rows }, rotation, state, { id: 'edge-house' });
    const result = executor.execute(placeObjectCommand(candidate));
    return { ok: result.success, refusedBy: [...new Set(result.errors.map((e) => e.ruleId))] };
  };
  return { w: { state }, act };
}

/** Click `item` onto the map with the object placer, its footprint's top-left at `c`; refused by the
 *  rules the refusal toast hears, or taken when an object landed. */
function clicked(w: SpecWorld, item: string, c: MacroCoord): Outcome {
  const heard: string[] = [];
  const off = w.sandbox.bus.on('validation-failed', ({ errors }) => { heard.push(...errors.map((e) => e.ruleId)); });
  try {
    const landed = placeItem(w, item, c);
    return { ok: landed !== null && heard.length === 0, refusedBy: [...new Set(heard)] };
  } finally {
    off();
  }
}

/** One corner-cut command at `c`, alone in a stroke, so the end-of-stroke rules judge it too. */
function trimInStroke(w: SpecWorld, c: MacroCoord, corners: Corners): Outcome {
  let refusedBy: readonly string[] = [];
  const stroke = inStroke(w, () => { refusedBy = run(w, trimTerrainCommand(c.x, c.y, corners)).refusedBy; });
  const all = [...new Set([...refusedBy, ...stroke.refusedBy])];
  return { ok: all.length === 0, refusedBy: all };
}

/** Two mountain caps one level up with water between them, falling south; the west cap. */
function waterfall(w: SpecWorld): MacroCoord {
  const at = spot(w, 3, 2);
  build(w, [[...rect(at, 3, 1), shift(at, 0, 1), shift(at, 2, 1)], M, 1], [[shift(at, 1, 1)], W, 1]);
  return shift(at, 0, 1);
}

/** The top-left cell of a chunk of open grass with another open chunk to its right. */
function openChunk(w: SpecWorld): MacroCoord {
  const origin = mapChunkOrigin(w.state.template);
  const open = openGrass(w);
  return cellWhere('open-chunk', w, (x, y) => (x - origin.x) % CHUNK_SIZE === 0 && (y - origin.y) % CHUNK_SIZE === 0
    && rect({ x, y }, 2 * CHUNK_SIZE, CHUNK_SIZE).every((c) => open(c.x, c.y)));
}

/** Plant as many trees as the chunk at `a` takes; the open cell where the next would go. */
function crowdChunk(w: SpecWorld, a: MacroCoord): MacroCoord {
  const fits = Math.floor(CHUNK_LOAD_LIMIT / getCatalogItem(TREE)!.loadValue);
  const side = Math.ceil(Math.sqrt(fits));
  for (let i = 0; i < fits; i++) placed(w, TREE, a.x + 2 * (i % side), a.y + 2 * Math.floor(i / side));
  return { x: a.x + 2 * side, y: a.y };
}

const CUT_BL: Corners = ['square', 'square', 'fan', 'square'];
const CUT_BR: Corners = ['square', 'square', 'square', 'fan'];

const CASES: readonly GameCase[] = [
  // Roads under and beside other objects.
  { rule: 'V-PLACE-OVERLAP', title: 'a road at a ramp\'s lower end', verdict: 'accepted', arrange: () => {
    const w = world(); const r = ramped(w);
    return { w, act: () => w.place(ROAD, r.x, r.y + 1) };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a road on the ramp cell over the cliff', verdict: ['V-PLACE-OVERLAP', 'V-PLACE-TRAIT'], arrange: () => {
    const w = world(); const r = ramped(w);
    return { w, act: () => w.place(ROAD, r.x, r.y) };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'an ordinary road laid under a tree', verdict: ['V-PLACE-OVERLAP'], arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, TREE, at.x, at.y);
    return { w, act: () => w.place(ROAD, at.x, at.y) };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a plantable road laid under a tree', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, TREE, at.x, at.y);
    return { w, act: () => w.place(PLANTABLE_ROAD, at.x, at.y) };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a plantable road laid under a flower', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, FLOWER, at.x, at.y);
    return { w, act: () => w.place(PLANTABLE_ROAD, at.x, at.y) };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a second road on one paving layer', verdict: ['V-PLACE-OVERLAP'], arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, ROAD, at.x, at.y);
    return { w, act: () => w.place(PLANTABLE_ROAD, at.x, at.y) };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a tree moved onto an ordinary road removes the road', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 6);
    const road = placed(w, ROAD, at.x, at.y); const tree = placed(w, TREE, at.x, at.y + 3);
    return { w, act: () => move(w, tree, at.x, at.y), after: () => expect(w.object(road.id)).toBeUndefined() };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a tree laid by one placement command on an ordinary road keeps the road', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); const road = placed(w, ROAD, at.x, at.y);
    return { w, act: () => w.place(TREE, at.x, at.y), after: () => expect(w.object(road.id)).toBeDefined() };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a tree clicked onto an ordinary road with the object placer removes the road', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); const road = placed(w, ROAD, at.x, at.y);
    return { w, act: () => clicked(w, TREE, at), after: () => expect(w.object(road.id)).toBeUndefined() };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a flower clicked onto an ordinary road with the object placer removes the road', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); const road = placed(w, ROAD, at.x, at.y);
    return { w, act: () => clicked(w, FLOWER, at), after: () => expect(w.object(road.id)).toBeUndefined() };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a stall placed on an ordinary road keeps the road', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); const road = placed(w, ROAD, at.x, at.y);
    return { w, act: () => w.place('building-stall', at.x, at.y), after: () => expect(w.object(road.id)).toBeDefined() };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a pavilion placed over an ordinary road keeps the road', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 8, 8); const road = placed(w, ROAD, at.x + 2, at.y + 2);
    return { w, act: () => w.place('facility-pavilion', at.x, at.y), after: () => expect(w.object(road.id)).toBeDefined() };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a house placed over an ordinary road keeps the road', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 6, 9); const road = placed(w, ROAD, at.x + 2, at.y + 2);
    return { w, act: () => w.place(HOUSE, at.x, at.y), after: () => expect(w.object(road.id)).toBeDefined() };
  } },
  // Objects left on roads when a stroke ends.
  { rule: 'V-PLACE-COATED', title: 'a tree on a plantable road in a stroke', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, PLANTABLE_ROAD, at.x, at.y);
    return { w, act: () => inStroke(w, () => w.place(TREE, at.x, at.y)) };
  } },
  { rule: 'V-PLACE-COATED', title: 'a tree on ordinary paving in a stroke', verdict: ['V-PLACE-COATED'], arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, ROAD, at.x, at.y);
    return { w, act: () => inStroke(w, () => w.place(TREE, at.x, at.y)) };
  } },
  { rule: 'V-PLACE-COATED', title: 'a flower on a plantable road in a stroke', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, PLANTABLE_ROAD, at.x, at.y);
    return { w, act: () => inStroke(w, () => w.place(FLOWER, at.x, at.y)) };
  } },
  { rule: 'V-PLACE-COATED', title: 'a flower on ordinary paving in a stroke', verdict: ['V-PLACE-COATED'], arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, ROAD, at.x, at.y);
    return { w, act: () => inStroke(w, () => w.place(FLOWER, at.x, at.y)) };
  } },
  { rule: 'V-PLACE-COATED', title: 'a stall on ordinary paving in a stroke', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, ROAD, at.x, at.y);
    return { w, act: () => inStroke(w, () => w.place('building-stall', at.x, at.y)) };
  } },
  { rule: 'V-PLACE-COATED', title: 'a pavilion over ordinary paving in a stroke', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 8, 8); placed(w, ROAD, at.x + 2, at.y + 2);
    return { w, act: () => inStroke(w, () => w.place('facility-pavilion', at.x, at.y)) };
  } },
  // A house's doorstep.
  { rule: 'V-PLACE-DOOR', title: 'a raised house with one row of its level before a drop', verdict: ['V-PLACE-DOOR'], arrange: () => raisedHouse(6) },
  { rule: 'V-PLACE-DOOR', title: 'a raised house with two rows of its level before a drop', verdict: 'accepted', arrange: () => raisedHouse(7) },
  { rule: 'V-PLACE-DOOR', title: 'a raised house with a drop at the door side\'s west end', verdict: ['V-PLACE-DOOR'], arrange: () => raisedHouse(7, (at) => shift(at, 0, 6)) },
  { rule: 'V-PLACE-DOOR', title: 'a raised house with a drop at the door side\'s east end', verdict: ['V-PLACE-DOOR'], arrange: () => raisedHouse(7, (at) => shift(at, 5, 6)) },
  { rule: 'V-PLACE-DOOR', title: 'a house with one row of grass before the sea', verdict: ['V-PLACE-DOOR'], arrange: () => houseBeforeSea(1) },
  { rule: 'V-PLACE-DOOR', title: 'a house with two rows of grass before the sea', verdict: 'accepted', arrange: () => houseBeforeSea(2) },
  { rule: 'V-PLACE-DOOR', title: 'a planet-editor house facing the map edge one row away', verdict: ['V-PLACE-DOOR'], arrange: () => houseBeforeMapEdge(1) },
  { rule: 'V-PLACE-DOOR', title: 'a planet-editor house facing the map edge two rows away', verdict: 'accepted', arrange: () => houseBeforeMapEdge(2) },
  { rule: 'V-PLACE-DOOR', title: 'a house turned to face a block two cells from its side', verdict: ['V-PLACE-DOOR'], arrange: () => {
    const w = world(); const at = spot(w, 5, 5, 4);
    build(w, [[shift(at, -2, 2)], M, 1]); const house = placed(w, HOUSE, at.x, at.y);
    return { w, act: () => turn(w, house, 90) };
  } },
  { rule: 'V-PLACE-DOOR', title: 'peeling the row just before a standing raised door', verdict: ['V-PLACE-DOOR'], arrange: () => {
    const w = world(); const at = spot(w, 6, 8);
    build(w, [rect(at, 6, 8), M, 1]); placed(w, HOUSE, at.x, at.y, { elevation: 1 });
    peel(w, rect(shift(at, 0, 7), 6, 1));
    return { w, act: () => peel(w, rect(shift(at, 0, 6), 6, 1)) };
  } },
  // Spacing between trees and houses.
  { rule: 'V-PLACE-TRAIT', title: 'a house touching another house\'s side', verdict: ['V-PLACE-TRAIT'], arrange: () => {
    const w = world(); const at = spot(w, 11, 5, 4); placed(w, HOUSE, at.x, at.y);
    return { w, act: () => w.place(OTHER_HOUSE, at.x + 5, at.y) };
  } },
  { rule: 'V-PLACE-TRAIT', title: 'a house one cell from another house', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 11, 5, 4); placed(w, HOUSE, at.x, at.y);
    return { w, act: () => w.place(OTHER_HOUSE, at.x + 6, at.y) };
  } },
  { rule: 'V-PLACE-TRAIT', title: 'a tree touching a house\'s side', verdict: ['V-PLACE-TRAIT'], arrange: () => {
    const w = world(); const at = spot(w, 7, 5, 4); placed(w, HOUSE, at.x, at.y);
    return { w, act: () => w.place(TREE, at.x + 5, at.y) };
  } },
  { rule: 'V-PLACE-TRAIT', title: 'a tree one cell from a house', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 7, 5, 4); placed(w, HOUSE, at.x, at.y);
    return { w, act: () => w.place(TREE, at.x + 6, at.y) };
  } },
  { rule: 'V-PLACE-TRAIT', title: 'a tree beside another tree', verdict: ['V-PLACE-TRAIT'], arrange: () => {
    const w = world(); const at = spot(w, 4, 4); placed(w, TREE, at.x, at.y);
    return { w, act: () => w.place(TREE, at.x + 1, at.y) };
  } },
  { rule: 'V-PLACE-TRAIT', title: 'a tree at another tree\'s corner', verdict: ['V-PLACE-TRAIT'], arrange: () => {
    const w = world(); const at = spot(w, 4, 4); placed(w, TREE, at.x, at.y);
    return { w, act: () => w.place(TREE, at.x + 1, at.y + 1) };
  } },
  { rule: 'V-PLACE-TRAIT', title: 'a tree one cell from another tree', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 4, 4); placed(w, TREE, at.x, at.y);
    return { w, act: () => w.place(TREE, at.x + 2, at.y) };
  } },
  { rule: 'V-PLACE-TRAIT', title: 'a flower beside a tree', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 4, 4); placed(w, TREE, at.x, at.y);
    return { w, act: () => w.place(FLOWER, at.x + 1, at.y) };
  } },
  // One of a kind.
  { rule: 'V-PLACE-MAX', title: 'a second copy of a one-of-a-kind house', verdict: ['V-PLACE-MAX'], arrange: () => {
    const w = world(); const a = spot(w, 5, 5, 4); placed(w, HOUSE, a.x, a.y); const b = w.openGround(5, 5, 4);
    return { w, act: () => w.place(HOUSE, b.x, b.y) };
  } },
  { rule: 'V-PLACE-MAX', title: 'moving the one copy of a one-of-a-kind house', verdict: 'accepted', arrange: () => {
    const w = world(); const a = spot(w, 6, 5, 4); const house = placed(w, HOUSE, a.x, a.y);
    return { w, act: () => move(w, house, a.x + 1, a.y) };
  } },
  { rule: 'V-PLACE-MAX', title: 'turning the one copy of a one-of-a-kind house', verdict: 'accepted', arrange: () => {
    const w = world(); const a = spot(w, 5, 5, 4); const house = placed(w, HOUSE, a.x, a.y);
    return { w, act: () => turn(w, house, 270) };
  } },
  // Sharing cells.
  { rule: 'V-PLACE-OVERLAP', title: 'two flowers on one cell', verdict: ['V-PLACE-OVERLAP'], arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, FLOWER, at.x, at.y);
    return { w, act: () => w.place(FLOWER, at.x, at.y) };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'two flowers edge to edge', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, FLOWER, at.x, at.y);
    return { w, act: () => w.place(FLOWER, at.x + 1, at.y) };
  } },
  { rule: 'V-PLACE-OVERLAP', title: 'a flower inside a turned pavilion\'s footprint', verdict: ['V-PLACE-OVERLAP'], arrange: () => {
    const w = world(); const at = spot(w, 8, 8); placed(w, 'facility-pavilion', at.x, at.y, { rotation: 90 });
    return { w, act: () => w.place(FLOWER, at.x + 2, at.y + 5) };
  } },
  // Ground zones.
  { rule: 'V-ZONE-01', title: 'a tree on the sea', verdict: ['V-ZONE-01'], arrange: () => {
    const w = world(); return { w, act: () => w.place(TREE, 1, 1) };
  } },
  ...sandCases(),
  { rule: 'V-ZONE-01', title: 'mountain on a grass cell whose upper neighbour is off grass', verdict: ['V-ZONE-01'], arrange: () => {
    const w = world(); const open = openGrass(w);
    const at = cellWhere('below-shore', w, (x, y) => groundAt(w, x, y - 1) !== GRASS_ZONE && rect({ x: x - 1, y }, 2, 2).every((c) => open(c.x, c.y)));
    return { w, act: () => w.stroke([at], M, 1) };
  } },
  // Terrain height and support.
  { rule: 'V-MTN-01', title: 'mountain at the tenth level over the ground', verdict: ['V-MTN-01'], arrange: () => {
    const w = world(); const c = shift(spot(w, 5, 5), 2, 2);
    // A stepped hill: each level on a full three-by-three base within three levels below it.
    for (let e = 1; e <= 9; e++) {
      const r = e <= 3 ? 2 : e <= 6 ? 1 : 0;
      build(w, [rect(shift(c, -r, -r), 2 * r + 1, 2 * r + 1), M, e]);
    }
    return { w, act: () => w.stroke([c], M, 10) };
  } },
  { rule: 'V-MTN-02', title: 'a mountain block two levels up over bare ground', verdict: ['V-MTN-02'], arrange: () => {
    const w = world(); const c = spot(w, 3, 3);
    return { w, act: () => w.stroke([c], M, 2) };
  } },
  { rule: 'V-WTR-01', title: 'water two levels up over bare ground inside a ring', verdict: ['V-WTR-01'], arrange: () => {
    const w = world(); const c = spot(w, 3, 3); const pool = shift(c, 1, 1);
    const ring = rect(c, 3, 3).filter((r) => cellKey(r.x, r.y) !== cellKey(pool.x, pool.y));
    build(w, [ring, M, 1], [ring, M, 2]);
    return { w, act: () => w.stroke([pool], W, 2) };
  } },
  { rule: 'V-MTN-03', title: 'a lone column\'s fourth level', verdict: ['V-MTN-03'], arrange: () => {
    const w = world(); const c = spot(w, 5, 5); build(w, [[c], M, 1], [[c], M, 2], [[c], M, 3]);
    return { w, act: () => w.stroke([c], M, 4) };
  } },
  { rule: 'V-MTN-03', title: 'a fourth level on a full three-by-three base', verdict: 'accepted', arrange: () => {
    const w = world(); const c = shift(spot(w, 5, 5), 2, 2);
    build(w, [rect(shift(c, -1, -1), 3, 3), M, 1], [[c], M, 2], [[c], M, 3]);
    return { w, act: () => w.stroke([c], M, 4) };
  } },
  { rule: 'V-MTN-03', title: 'a fourth level on a base with one corner missing', verdict: ['V-MTN-03'], arrange: () => {
    const w = world(); const c = shift(spot(w, 5, 5), 2, 2);
    build(w, [rect(shift(c, -1, -1), 3, 3).filter((b) => cellKey(b.x, b.y) !== cellKey(c.x - 1, c.y - 1)), M, 1], [[c], M, 2], [[c], M, 3]);
    return { w, act: () => w.stroke([c], M, 4) };
  } },
  // Water.
  { rule: 'V-WTR-02', title: 'water with one open side', verdict: ['V-WTR-02'], arrange: () => {
    const w = world(); const a = spot(w, 3, 1); build(w, [[a], M, 1]);
    return { w, act: () => w.stroke([shift(a, 1, 0)], W, 1) };
  } },
  { rule: 'V-WTR-02', title: 'a waterfall between two caps at its level', verdict: 'accepted', arrange: () => {
    const w = world(); const a = spot(w, 3, 1); build(w, [[a, shift(a, 2, 0)], M, 1]);
    return { w, act: () => w.stroke([shift(a, 1, 0)], W, 1) };
  } },
  { rule: 'V-WTR-02', title: 'a block stacked on a waterfall cap', verdict: ['V-WTR-02'], arrange: () => {
    const w = world(); const cap = waterfall(w);
    return { w, act: () => w.stroke([cap], M, 2) };
  } },
  { rule: 'V-WTR-03', title: 'a step in the row below a waterfall', verdict: ['V-WTR-03'], arrange: () => {
    const w = world(); const cap = waterfall(w);
    return { w, act: () => w.stroke([shift(cap, 0, 1)], M, 1) };
  } },
  { rule: 'V-WTR-03', title: 'a step just outside the waterfall\'s width', verdict: 'accepted', arrange: () => {
    const w = world(); const cap = waterfall(w);
    return { w, act: () => w.stroke([shift(cap, -1, 1)], M, 1) };
  } },
  { rule: 'EDIT-16', title: 'a stroke cutting a waterfall cap\'s corner away from the water', verdict: 'accepted', arrange: () => {
    const w = world(); const cap = waterfall(w);
    return { w, act: () => trimInStroke(w, cap, CUT_BL), after: () => expect(w.state.cells[cap.y]![cap.x]!.terrain?.corners?.[2]).toBe('fan') };
  } },
  { rule: 'EDIT-16', title: 'a stroke cutting a waterfall cap\'s corner at the lip is taken and leaves it square', verdict: 'accepted', arrange: () => {
    const w = world(); const cap = waterfall(w);
    return { w, act: () => trimInStroke(w, cap, CUT_BR), after: () => expect(w.state.cells[cap.y]![cap.x]!.terrain?.corners?.[3] ?? 'square').toBe('square') };
  } },
  // Locks.
  { rule: 'V-LOCK-01', title: 'painting at a locked layer', verdict: ['V-LOCK-01'], arrange: () => {
    const w = world(); const c = spot(w, 3, 3); build(w, [[c], M, 1]); setLayerLocked(w, 2, true);
    return { w, act: () => w.stroke([c], M, 2) };
  } },
  { rule: 'V-LOCK-01', title: 'painting the layer below a locked one', verdict: 'accepted', arrange: () => {
    const w = world(); const c = spot(w, 3, 3); setLayerLocked(w, 2, true);
    return { w, act: () => w.stroke([c], M, 1) };
  } },
  { rule: 'V-LOCK-02', title: 'removing the planet\'s landmark', verdict: ['V-LOCK-02'], arrange: () => {
    const w = world(); const landmark = landmarkOf(w);
    return { w, act: () => w.remove(landmark.id) };
  } },
  { rule: 'V-LOCK-02', title: 'bulk-deleting the landmark with a tree keeps the landmark', verdict: 'accepted', arrange: () => {
    const w = world(); const landmark = landmarkOf(w); const at = spot(w, 3, 3); const tree = placed(w, TREE, at.x, at.y);
    return {
      w,
      act: () => { const r = w.sandbox.deleteGroup([landmark.id, tree.id]); return { ok: r.deleted > 0, refusedBy: [] }; },
      after: () => { expect(w.object(landmark.id)).toEqual(landmark); expect(w.object(tree.id)).toBeUndefined(); },
    };
  } },
  // Chunk load.
  { rule: 'V-CHUNK-01', title: 'a tree that pushes a chunk past 10,000', verdict: ['V-CHUNK-01'], arrange: () => {
    const w = world(); const next = crowdChunk(w, openChunk(w));
    return { w, act: () => w.place(TREE, next.x, next.y) };
  } },
  { rule: 'V-CHUNK-01', title: 'a lighter tree that keeps the full chunk within 10,000', verdict: 'accepted', arrange: () => {
    const w = world(); const next = crowdChunk(w, openChunk(w));
    return { w, act: () => w.place('tree-fir', next.x, next.y) };
  } },
  // Terrain on objects' cells.
  { rule: 'V-PLACE-BLOCK', title: 'mountain painted on a tree\'s cell', verdict: ['V-PLACE-BLOCK'], arrange: () => {
    const w = world(); const at = spot(w, 4, 3); placed(w, TREE, at.x, at.y);
    return { w, act: () => w.stroke([at], M, 1) };
  } },
  { rule: 'V-PLACE-BLOCK', title: 'mountain painted on the cell a tree reaches across the offset', verdict: ['V-PLACE-BLOCK'], arrange: () => {
    const w = world(); const at = spot(w, 4, 3); placed(w, TREE, at.x, at.y);
    return { w, act: () => w.stroke([shift(at, 1, 1)], M, 1) };
  } },
  { rule: 'V-PLACE-BLOCK', title: 'mountain painted under a road carries the road up', verdict: 'accepted', arrange: () => {
    const w = world(); const at = spot(w, 3, 3); const road = placed(w, ROAD, at.x, at.y);
    return { w, act: () => w.stroke(rect(at, 2, 2), M, 1), after: () => expect(w.object(road.id)?.elevation).toBe(1) };
  } },
  { rule: 'V-PLACE-BLOCK', title: 'water painted onto a road', verdict: ['V-PLACE-BLOCK'], arrange: () => {
    const w = world(); const at = spot(w, 3, 3); placed(w, ROAD, at.x, at.y);
    return { w, act: () => w.stroke([at], W, 1) };
  } },
  // The ground itself.
  { rule: 'V-GROUND-LOCK', title: 'turning land into sea on a map', verdict: ['V-GROUND-LOCK'], arrange: () => {
    const w = world(); const at = spot(w, 3, 3);
    return { w, act: () => run(w, eraseTerrainCommand([at], OFF_MAP_ZONE)) };
  } },
  { rule: 'V-GROUND-LOCK', title: 'turning land into sea in the planet editor', verdict: 'accepted', arrange: () => {
    const p = new PlanetWorld(); const at = spot(world(), 3, 3);
    return { w: p, act: () => p.ground([at], OFF_MAP_ZONE) };
  } },
];

/** The sand cases: a 5-by-8 sand patch with the shore rim just past its right side. */
function sandCases(): GameCase[] {
  const patch = (w: SpecWorld): MacroCoord => {
    const sand = (x: number, y: number) => groundAt(w, x, y) === SAND_ZONE;
    return cellWhere('sand-patch', w, (x, y) => y >= 2 && rect({ x, y }, 5, 8).every((c) => sand(c.x, c.y)) && !sand(x + 5, y) && groundAt(w, x + 5, y) !== null);
  };
  const on = (title: string, verdict: Verdict, act: (w: SpecWorld, at: MacroCoord) => Outcome): GameCase => ({
    rule: 'V-ZONE-01', title, verdict, arrange: () => { const w = world(); const at = patch(w); return { w, act: () => act(w, at) }; },
  });
  return [
    on('a tree on sand', ['V-ZONE-01'], (w, at) => w.place(TREE, at.x, at.y)),
    on('a road on sand', ['V-ZONE-01'], (w, at) => w.place(ROAD, at.x, at.y)),
    on('mountain on sand', ['V-ZONE-01'], (w, at) => w.stroke([shift(at, 1, 1)], M, 1)),
    on('water on sand', ['V-ZONE-01'], (w, at) => w.stroke([shift(at, 1, 1)], W, 1)),
    on('a house wholly on sand', 'accepted', (w, at) => w.place(HOUSE, at.x, at.y)),
    on('a house one cell onto the shore rim', ['V-ZONE-01'], (w, at) => w.place(HOUSE, at.x + 1, at.y)),
    {
      rule: 'V-ZONE-01', title: 'a planet-editor house straddling grass and sand', verdict: ['V-ZONE-01'], arrange: () => {
        const p = new PlanetWorld(); const at = spot(world(), 6, 9);
        const made = p.ground(rect(shift(at, 3, 0), 3, 9), SAND_ZONE);
        if (!made.ok) throw new Error(`arranging sand was refused by ${made.refusedBy.join(', ')}`);
        return { w: p, act: () => p.place(HOUSE, at.x, at.y) };
      },
    },
    {
      rule: 'V-ZONE-01', title: 'a planet-editor house wholly on painted sand', verdict: 'accepted', arrange: () => {
        const p = new PlanetWorld(); const at = spot(world(), 6, 9);
        const made = p.ground(rect(at, 6, 9), SAND_ZONE);
        if (!made.ok) throw new Error(`arranging sand was refused by ${made.refusedBy.join(', ')}`);
        return { w: p, act: () => p.place(HOUSE, at.x, at.y) };
      },
    },
  ];
}

describe('the game\'s rule cases', () => {
  for (const c of CASES) {
    spec(c.rule, `${c.title}: ${c.verdict === 'accepted' ? 'accepted' : `refused by ${c.verdict.join(', ')}`}`, () => {
      const { w, act, after } = c.arrange();
      const before = c.verdict === 'accepted' ? null : snapshot(w.state);
      const outcome = act();
      expect(verdictOf(outcome)).toEqual(c.verdict);
      if (outcome.ok) after?.();
      else expect(snapshot(w.state), 'a refused action leaves the map as it was').toBe(before);
    });
  }
});
