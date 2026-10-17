import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectPlacerTool } from '../../../tools/pointer/objects/object-placer';
import { placeTileCell } from '../../../tools/pointer/paint/tile-coating';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules/index';
import { getCatalogItem, getPlaceableByCategory, getPlaceableWhere, getRoadMaterials, landmarkItem } from '../../../state/catalog';
import { getPlacedObjectSize, snapsOwnPlacement } from '../../../state/object-geometry';
import { hasTrait, isCoatingItem } from '../../../core/model/traits';
import { getFootprint } from '../../../core/grid/footprint';
import { isBuildableZone } from '../../../core/game/zones';
import { createGridState } from '../../../core/model/template';
import { getMapTemplate } from '../../../config/maps';
import { serialize, decodeSave } from '../../../io/save/json-codec';
import { clearUnderLandmarks } from '../../../state/landmark-clearance';
import { parseSave } from '../../../io/save/parse';
import { encodeMapPayload, decodeMapPayload } from '../../../io/share/codec/payload';
import { toSaveJSON } from '../../../io/save/canonical';
import { ROTATIONS, type GridState, type MacroCoord, type Rotation } from '../../../core/model/types';
import { makeToolCtx } from '../../_support/tool-ctx';
import { buildShareCode, importFromRaster } from '../../../io/share';
import { CURRENT_VERSION } from '../../../io/save/format';
import { readAutosave } from '../../../io/storage/autosave';
import { AUTOSAVE_DEBOUNCE_MS } from '../../../io/storage/facts';
import { autosave } from '../../../editor/session/autosave';
import { rotateObject } from '../../../tools/objects/actions';
import { moveGroup, deleteGroup } from '../../../tools/objects/group-actions';
import { buildTransfer } from '../../../tools/generation/transfer';
import { setStoreState, resetStore } from '../../_support/store';
import { cell, point } from '../../_support/grid';
import { makeExecutor } from '../../_support/map-state';
import { exportable } from '../../_support/exportable';
import { ItemCategory } from '../../../config/catalog/categories';

beforeEach(resetStore);

vi.mock('../../../editor/host/host', () => ({
  host: { camera: { get2d: () => undefined, get3d: () => undefined } },
}));

vi.setConfig({ testTimeout: 120_000 });

const exec = (s: GridState) => makeExecutor(s);

/** Supporting structures a person can place. */
const supporters = [...getPlaceableByCategory(ItemCategory.Building), ...getPlaceableByCategory(ItemCategory.Facility)]
  .filter(i => hasTrait(i, 'coatingSupport') && !i.disabled && i.placementMode === 'point');
const surfaces = getRoadMaterials();

/** The top-left corner of an empty buildable square on the map, away from every landmark. */
function openSquare(state: GridState, side: number): MacroCoord {
  const { width, height } = state.template;
  const occupied = new Set<string>();
  for (const o of state.objects.values()) {
    const { w, h } = getPlacedObjectSize(o);
    for (const c of getFootprint(Math.floor(o.position.x) - 2, Math.floor(o.position.y) - 2, Math.ceil(w) + 4, Math.ceil(h) + 4)) occupied.add(`${c.x},${c.y}`);
  }
  for (let y = 4; y + side < height - 4; y++) {
    for (let x = 4; x + side < width - 4; x++) {
      let ok = true;
      for (let dy = -1; dy <= side && ok; dy++) for (let dx = -1; dx <= side && ok; dx++) {
        const cell = state.cells[y + dy]?.[x + dx];
        ok = !!cell && isBuildableZone(cell.zone) && !cell.terrain && !occupied.has(`${x + dx},${y + dy}`);
      }
      if (ok) return { x, y };
    }
  }
  throw new Error('no open square');
}

interface Scene { state: GridState; ex: CommandExecutor; origin: MacroCoord }

function scene(): Scene {
  const state = createGridState(getMapTemplate('hexia'));
  return { state, ex: exec(state), origin: openSquare(state, 12) };
}

function paintRoad(s: Scene, material: string, cells: MacroCoord[]): void {
  const ctx = makeToolCtx(s.state, s.ex, 1, 1, { tileMaterial: material });
  const start = s.ex.beginStroke();
  const painted = new Set<string>();
  for (const c of cells) expect(placeTileCell(c, ctx, painted), `road ${material} at ${c.x},${c.y}`).toBe(true);
  expect(start.commit()).toEqual([]);
}

function placeBuilding(s: Scene, itemId: string, at: MacroCoord, rotation: Rotation): void {
  const ctx = makeToolCtx(s.state, s.ex, 1, 1, { armedItem: itemId, placementRotation: rotation });
  const start = s.ex.beginStroke();
  new ObjectPlacerTool().onPointerDown(cell(at), point(at), ctx);
  expect(start.size, `${itemId} rotation ${rotation} placed`).toBe(1);
  expect(start.commit()).toEqual([]);
}

const unlocked = (state: GridState) => [...state.objects.values()].filter(o => !o.locked);
const roadsOf = (state: GridState) => unlocked(state).filter(o => isCoatingItem(getCatalogItem(o.catalogId)));
const solidsOf = (state: GridState) => unlocked(state).filter(o => !isCoatingItem(getCatalogItem(o.catalogId)));

/** The cells beneath a placed building, by anchor and rotated size. */
function footprintOf(itemId: string, at: MacroCoord, rotation: Rotation): MacroCoord[] {
  const { w, h } = getPlacedObjectSize({ id: 'p', catalogId: itemId, position: at, rotation, elevation: 0 });
  return getFootprint(at.x, at.y, Math.ceil(w), Math.ceil(h));
}

const comparable = (state: GridState) => ({
  objects: unlocked(state).map(o => ({ id: o.id, catalogId: o.catalogId, x: o.position.x, y: o.position.y, rotation: o.rotation, elevation: o.elevation }))
    .sort((a, b) => a.id.localeCompare(b.id)),
  terrain: state.cells.flatMap((row, y) => row.flatMap((c, x) => c.terrain ? [`${x},${y}:${c.terrain.type}@${c.terrain.elevation}`] : [])),
});

describe('roads beneath supporting structures', () => {
  it('offers supporting buildings and facilities and every pavement surface', () => {
    expect(supporters.length).toBeGreaterThan(5);
    expect(supporters.some(i => i.category === ItemCategory.Facility)).toBe(true);
    expect(surfaces.length).toBeGreaterThan(20);
  });

  it.each(supporters.flatMap(item => (item.rotatable ? ROTATIONS : [0 as Rotation]).map(r => [item.id, r] as const)))(
    '%s at rotation %s keeps its roads in both orders, through undo and redo',
    (itemId, rotation) => {
      for (const order of ['road-first', 'building-first'] as const) {
        const s = scene();
        const at = { x: s.origin.x + 2, y: s.origin.y + 2 };
        const under = footprintOf(itemId, at, rotation);
        if (order === 'road-first') { paintRoad(s, surfaces[0]!.id, under); placeBuilding(s, itemId, at, rotation); }
        else { placeBuilding(s, itemId, at, rotation); paintRoad(s, surfaces[0]!.id, under); }
        expect(roadsOf(s.state), order).toHaveLength(under.length);
        expect(solidsOf(s.state), order).toHaveLength(1);
        expect(s.ex.getRegistry().validatePostStroke(s.state), order).toEqual([]);
        const done = comparable(s.state);
        s.ex.undo();
        expect(order === 'road-first' ? solidsOf(s.state) : roadsOf(s.state), `${order} undo`).toHaveLength(0);
        expect(order === 'road-first' ? roadsOf(s.state) : solidsOf(s.state), `${order} undo keeps the other`).toHaveLength(order === 'road-first' ? under.length : 1);
        s.ex.redo();
        expect(comparable(s.state), `${order} redo`).toEqual(done);
      }
    },
  );

  it.each(surfaces.map(i => i.id))('%s stays beneath a house in both orders', (material) => {
    const house = supporters[0]!.id;
    for (const order of ['road-first', 'building-first'] as const) {
      const s = scene();
      const at = { x: s.origin.x + 2, y: s.origin.y + 2 };
      const under = footprintOf(house, at, 0);
      if (order === 'road-first') { paintRoad(s, material, under); placeBuilding(s, house, at, 0); }
      else { placeBuilding(s, house, at, 0); paintRoad(s, material, under); }
      expect(roadsOf(s.state).map(o => o.catalogId), order).toEqual(under.map(() => material));
      expect(s.ex.getRegistry().validatePostStroke(s.state)).toEqual([]);
    }
  });

  /** One map with every supporting structure standing on a different surface, some rotated. */
  function mixedMap(): GridState {
    const state = createGridState(getMapTemplate('hexia'));
    const ex = exec(state);
    const taken = new Set<string>();
    supporters.forEach((item, i) => {
      const rotation = (item.rotatable ? ROTATIONS[i % 4] : 0) as Rotation;
      const s: Scene = { state, ex, origin: { x: 0, y: 0 } };
      for (let y = 6; y < state.template.height - 20; y += 2) {
        for (let x = 6; x < state.template.width - 20; x += 2) {
          const at = { x, y };
          const under = footprintOf(item.id, at, rotation);
          const size = getPlacedObjectSize({ id: 'p', catalogId: item.id, position: at, rotation, elevation: 0 });
          const w = Math.ceil(size.w), h = Math.ceil(size.h);
          const ring = getFootprint(x - 2, y - 2, w + 4, h + 4);
          const fits = ring.every(c => {
            const cell = state.cells[c.y]?.[c.x];
            return cell && isBuildableZone(cell.zone) && !cell.terrain && !taken.has(`${c.x},${c.y}`);
          });
          if (!fits) continue;
          const ctx = makeToolCtx(state, ex, 1, 1, { armedItem: item.id, placementRotation: rotation });
          const before = ex.beginStroke();
          new ObjectPlacerTool().onPointerDown(cell(at), point(at), ctx);
          if (before.size === 0) continue;
          before.commit();
          // The footprint plus a walkway along its lower edge, partly outside the building.
          paintRoad(s, surfaces[i % surfaces.length]!.id, [...under, ...getFootprint(x - 1, y + h, w + 2, 1)]);
          for (const c of ring) taken.add(`${c.x},${c.y}`);
          return;
        }
      }
      throw new Error(`no room for ${item.id}`);
    });
    expect(createDefaultRegistry().validatePostStroke(state)).toEqual([]);
    return state;
  }

  it('a saved map with roads under buildings loads unchanged', () => {
    const state = mixedMap();
    const json = serialize(state);
    const loaded = decodeSave(parseSave(JSON.parse(json), { template: state.template }));
    const cleared = clearUnderLandmarks(loaded, createDefaultRegistry());
    expect(cleared).toEqual({ objects: 0, cells: 0, restored: 0 });
    expect(comparable(loaded)).toEqual(comparable(state));
    expect(createDefaultRegistry().validatePostStroke(loaded)).toEqual([]);
  });

  it('a landmark clearance takes only what it stands over, leaving roads under buildings elsewhere', () => {
    const state = mixedMap();
    const kept = comparable(state).objects;
    const plaza = [...state.objects.values()].find(o => o.locked && o.catalogId === landmarkItem().id)!;
    const edge = { x: Math.floor(plaza.position.x + (plaza.width ?? 0)) - 1, y: Math.floor(plaza.position.y) + 4 };
    const house = supporters[0]!.id;
    // A save from before the landmark grew: a house on its road reaching over the plaza's edge.
    for (const c of footprintOf(house, edge, 0)) {
      state.objects.set(`old-road-${c.x}-${c.y}`, { id: `old-road-${c.x}-${c.y}`, catalogId: surfaces[0]!.id, position: c, rotation: 0, elevation: 0 });
    }
    state.objects.set('old-house', { id: 'old-house', catalogId: house, position: edge, rotation: 0, elevation: 0 });
    const loaded = decodeSave(parseSave(JSON.parse(serialize(state)), { template: state.template }));
    const cleared = clearUnderLandmarks(loaded, createDefaultRegistry());
    expect(cleared.objects).toBeGreaterThan(1);
    expect(loaded.objects.has('old-house')).toBe(false);
    expect(comparable(loaded).objects.filter(o => !o.id.startsWith('old-'))).toEqual(kept);
    expect(createDefaultRegistry().validatePostStroke(loaded)).toEqual([]);
  });

  const withoutIds =(c: ReturnType<typeof comparable>) => ({
    ...c, objects: c.objects.map(({ id: _id, ...rest }) => rest).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  });

  it('a share code with roads under buildings decodes unchanged', async () => {
    const state = mixedMap();
    const decoded = await decodeMapPayload(await encodeMapPayload(state, null, { appVersion: 'roads-under', saveVersion: 1 }));
    const loaded = decodeSave(parseSave(JSON.parse(toSaveJSON(decoded.canonical, decoded.annotations)), { template: state.template }));
    const cleared = clearUnderLandmarks(loaded, createDefaultRegistry());
    expect(cleared).toEqual({ objects: 0, cells: 0, restored: 0 });
    expect(withoutIds(comparable(loaded))).toEqual(withoutIds(comparable(state)));
  });

  it('a share image with roads under buildings imports unchanged', async () => {
    const state = mixedMap();
    const code = await buildShareCode(exportable(state), null, { appVersion: 'roads-under', saveVersion: CURRENT_VERSION }, 1600);
    const result = await importFromRaster(code!.rgba, code!.width, code!.height);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cleared).toEqual({ objects: 0, cells: 0, restored: 0 });
    expect(withoutIds(comparable(result.state))).toEqual(withoutIds(comparable(state)));
  });

  it('an autosave with roads under buildings restores unchanged, with its undo history', () => {
    vi.useFakeTimers();
    try {
      const s = scene();
      const at = { x: s.origin.x + 2, y: s.origin.y + 2 };
      const house = supporters[0]!.id;
      paintRoad(s, surfaces[1]!.id, footprintOf(house, at, 90));
      placeBuilding(s, house, at, 90);
      setStoreState({ commandExecutor: s.ex, gridState: s.state });
      autosave.schedule(s.state);
      vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS);
      const restored = readAutosave();
      expect(restored?.cleared).toEqual({ objects: 0, cells: 0, restored: 0 });
      expect(comparable(restored!.state)).toEqual(comparable(s.state));
      expect(restored!.history?.length).toBeGreaterThan(0);
      const back = exec(restored!.state);
      back.restoreHistory(restored!.history!);
      back.undo();
      expect(solidsOf(restored!.state), 'undo after restore takes the house').toHaveLength(0);
      expect(roadsOf(restored!.state), 'and keeps its road').toHaveLength(footprintOf(house, at, 90).length);
      autosave.clear();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a building standing on a road rotates, moves and leaves, keeping the road', () => {
    const s = scene();
    const house = supporters[0]!.id;
    const at = { x: s.origin.x + 2, y: s.origin.y + 2 };
    paintRoad(s, surfaces[2]!.id, getFootprint(s.origin.x, s.origin.y, 12, 12));
    placeBuilding(s, house, at, 0);
    const roads = roadsOf(s.state).length;
    const placed = () => solidsOf(s.state)[0]!;
    expect(rotateObject(s.ex, s.state, placed(), 90, { from: 0, to: 90 }).ok).toBe(true);
    expect(placed().rotation).toBe(90);
    expect(moveGroup(s.ex, s.state, [placed().id], { dx: 1, dy: 1 }).refusal).toBeNull();
    expect(placed().position).toEqual({ x: at.x + 1, y: at.y + 1 });
    expect(roadsOf(s.state)).toHaveLength(roads);
    expect(s.ex.getRegistry().validatePostStroke(s.state)).toEqual([]);
    expect(deleteGroup(s.ex, s.state, [placed().id]).deleted).toBe(1);
    expect(roadsOf(s.state)).toHaveLength(roads);
  });

  // `rotateObject` turns one object in place without the coating strip a move or a group rotation
  // runs; that is sound only while no turn can cover a road the item may not stand on.
  it('a single-object turn never covers a road it would have to strip', () => {
    const size = (id: string, rotation: Rotation) => getPlacedObjectSize({ id: 'p', catalogId: id, position: { x: 0, y: 0 }, rotation, elevation: 0 });
    const reshaped = getPlaceableWhere(i => i.rotatable && !snapsOwnPlacement(i) && size(i.id, 0).w !== size(i.id, 90).w);
    expect(reshaped.length).toBeGreaterThan(0);
    for (const item of reshaped) expect(hasTrait(item, 'coatingSupport'), `${item.id} turns onto cells it would strip`).toBe(true);
  });

  it('Change Planet carries roads under buildings', () => {
    const state = mixedMap();
    const built = buildTransfer(state, getMapTemplate('tafa'));
    expect(built.violations).toEqual([]);
    expect(built.dropped.objects ?? 0).toBe(0);
    expect(roadsOf(built.dest)).toHaveLength(roadsOf(state).length);
    expect(solidsOf(built.dest)).toHaveLength(solidsOf(state).length);
  });
});
