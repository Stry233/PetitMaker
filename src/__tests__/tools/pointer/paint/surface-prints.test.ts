import { describe, expect, it } from 'vitest';
import { placeTileCell, eraseTileCells } from '../../../../tools/pointer/paint/tile-coating';
import { stripCoatingsFor } from '../../../../tools/placement/coatings';
import { makeToolCtx } from '../../../_support/tool-ctx';
import { makeState, makeExecutor, paintCmd, placeCmd } from '../../../_support/map-state';
import { TerrainType, type PlacedObject } from '../../../../core/model/types';
import { roadLookup, objectAt, getObjectIndex } from '../../../../state/object-index';
import { buildRoadTrimMeshes } from '../../../../view/map3d/geometry/road-mesh';
import { getRoadMaterials, getCatalogItem } from '../../../../state/catalog';
import { encodeMapPayload, decodeMapPayload } from '../../../../io/share/codec/payload';
import { canonicalBytes, canonicalize } from '../../../../io/save/canonical';
import { getMapTemplate } from '../../../../config/maps';
import { createGridState } from '../../../../core/model/template';

const pavement = 'path-simple-brick', print = 'print-field-junction';
const at = { x: 4, y: 4 };
function setup() {
  const state = makeState(20, 20), executor = makeExecutor(state);
  const ctx = (tileMaterial: string) => makeToolCtx(state, executor, 1, 1, { tileMaterial, contentType: 'road', placementRotation: 90 });
  const paint = (id: string) => {
    const start = executor.beginStroke();
    expect(placeTileCell(at, ctx(id), new Set())).toBe(true);
    expect(start.commit()).toEqual([]);
  };
  const ids = () => [...state.objects.values()].map(o => o.catalogId).sort();
  return { state, executor, ctx, paint, ids };
}

describe('independent surface prints', () => {
  it('paints, replaces and erases each layer independently with undo and redo', () => {
    const { state, executor, ctx, paint, ids } = setup();
    paint(pavement); paint(print);
    expect(ids()).toEqual([pavement, print]);
    expect(roadLookup(state)(at.x, at.y)?.catalogId).toBe(pavement);
    expect(objectAt(getObjectIndex(state), at)?.catalogId).toBe(print);
    expect([...state.objects.values()].find(o => o.catalogId === print)?.rotation).toBe(90);
    paint('print-field-cross');
    expect(ids()).toEqual([pavement, 'print-field-cross']);
    executor.undo(); expect(ids()).toEqual([pavement, print]);
    executor.redo(); expect(ids()).toEqual([pavement, 'print-field-cross']);
    let start = executor.beginStroke();
    eraseTileCells([at], ctx(print));
    expect(start.commit()).toEqual([]);
    expect(ids()).toEqual([pavement]);
    executor.undo();
    start = executor.beginStroke();
    eraseTileCells([at], ctx(pavement));
    expect(start.commit()).toEqual([]);
    expect(ids()).toEqual(['print-field-cross']);
  });

  it('reseats both layers after terrain painting and removes both on a partial cliff', () => {
    const { state, executor, paint } = setup();
    paint(pavement); paint(print);
    let start = executor.beginStroke();
    for (const [x, y] of [[4,4],[5,4],[4,5],[5,5]] as const) expect(executor.execute(paintCmd([{x,y}], TerrainType.Mountain, 1)).success).toBe(true);
    expect(start.commit()).toEqual([]);
    expect(state.objects.size).toBe(2);
    for (const o of state.objects.values()) expect(o.elevation).toBe(1);
    start = executor.beginStroke();
    expect(executor.execute(paintCmd([at], TerrainType.Mountain, 0)).success).toBe(true);
    expect(start.commit()).toEqual([]);
    expect(state.objects.size).toBe(0);
    executor.undo(); expect(state.objects.size).toBe(2);
  });

  it('preserves an independent print when pavement is moved over it', () => {
    const { state, executor, paint } = setup();
    paint(print);
    stripCoatingsFor(executor, state, { id: 'moved', catalogId: pavement, position: at, rotation: 0, elevation: 0 });
    expect(state.objects.size).toBe(1);
  });

  it('supports buildings over roads in either placement order and still rejects solid overlap', () => {
    for (const houseFirst of [true, false]) {
      const { state, executor, paint } = setup();
      const house: PlacedObject = { id: 'house', catalogId: 'building-stall', position: at, rotation: 0, elevation: 0 };
      const placeHouse = () => {
        const start = executor.beginStroke();
        stripCoatingsFor(executor, state, house);
        expect(executor.execute(placeCmd(house)).success).toBe(true);
        expect(start.commit()).toEqual([]);
      };
      if (houseFirst) { placeHouse(); paint(pavement); } else { paint(pavement); placeHouse(); }
      expect(state.objects.size).toBe(2);
      expect(objectAt(getObjectIndex(state), at)?.id).toBe('house');
      expect(executor.execute(placeCmd({ ...house, id: 'second-house' })).success).toBe(false);
    }
  });

  it('meshes prints above roads with per-cell quarter-turn UVs', () => {
    const { state, paint } = setup();
    paint(pavement); paint(print);
    const parts = buildRoadTrimMeshes(state);
    const p = parts.find(p => p.material === print)!;
    const r = parts.find(p => p.material === pavement)!;
    expect(p.mesh.positions.filter((_, i) => i % 3 === 1)[0]).toBeGreaterThan(r.mesh.positions[1]!);
    expect(p.mesh.uv).toEqual([0, 1, 1, 1, 1, 0, 0, 0].map(v => expect.closeTo(v, 6)));
    expect(p.pattern).toBe(getCatalogItem(print)!.surfacePrint);
    expect(p.pattern).not.toHaveProperty('background');
  });

  it('round-trips every print over pavement through share encoding', async () => {
    const state = createGridState(getMapTemplate('hexia'));
    getRoadMaterials(true).forEach((item, i) => {
      const position = { x: 30 + i, y: 30 };
      for (const [id, catalogId] of [[`road-${i}`, pavement], [`print-${i}`, item.id]]) {
        state.objects.set(id!, { id: id!, catalogId: catalogId!, position, rotation: 90, elevation: 0 });
      }
    });
    const decoded = await decodeMapPayload(await encodeMapPayload(state, null, { appVersion: 'surface-test', saveVersion: 1 }));
    expect(canonicalBytes(decoded.canonical)).toEqual(canonicalBytes(canonicalize(state)));
  });
});
