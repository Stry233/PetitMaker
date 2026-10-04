import { describe, expect, it } from 'vitest';
import { objectInstance } from '../../canvas/map3d/build/object-meshes';
import { CommandType, ItemCategory, TerrainType, type PlaceObjectCommand } from '../../core/model/types';
import { createDefaultRegistry } from '../../rules';
import { getCatalogByCategory } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import { crossingExitCells } from '../../tools/placement/network';
import { crossingEnds } from '../../tools/placement/themes';
import { makeState, setTerrain } from './_helpers';

const faces = [
  { rotation: 0, x: 12.5, y: 19, axis: 'y', sign: 1, high: 19 },
  { rotation: 90, x: 19, y: 12.5, axis: 'x', sign: 1, high: 19 },
  { rotation: 180, x: 12.5, y: 8, axis: 'y', sign: -1, high: 8 },
  { rotation: 270, x: 8, y: 12.5, axis: 'x', sign: -1, high: 8 },
] as const;
const ramps = getCatalogByCategory(ItemCategory.Ramp);

describe.each(ramps)('$id footprint and connections', (item) => {
  it.each(faces)('reserves 1.5 lower cells and 0.5 upper cells at rotation $rotation', (face) => {
    expect(item.height).toBe(2);
    for (const low of [0, 2]) {
      const state = makeState(32, 32);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const elevation = x >= 8 && x <= 19 && y >= 8 && y <= 19 ? low + 1 : low;
        if (elevation) setTerrain(state, x, y, TerrainType.Mountain, elevation);
      }
      const cmd: PlaceObjectCommand = {
        type: CommandType.PlaceObject, timestamp: 0,
        object: { id: 'ramp', catalogId: item.id, position: { x: face.x, y: face.y }, rotation: 0, elevation: 0 },
      };
      expect(createDefaultRegistry().validatePreCommand(cmd, state)).toEqual([]);
      expect(cmd.object.rotation).toBe(face.rotation);
      expect(cmd.object.elevation).toBe(low + 1);
      const r = objectRect(cmd.object);
      const start = face.axis === 'x' ? r.x : r.y;
      const run = face.axis === 'x' ? r.w : r.h;
      const cliff = face.high + face.sign * 0.5;
      const upper = face.sign === 1 ? cliff - start : start + run - cliff;
      expect(upper).toBe(0.5);
      expect(run - upper).toBe(1.5);
      expect(face.axis === 'x' ? r.h : r.w).toBe(item.width);
      const ends = crossingEnds(cmd.object);
      const exits = crossingExitCells(cmd.object);
      for (const pair of [ends, [exits[0][0]!, exits[1][0]!]]) {
        expect(pair[1]![face.axis] - pair[0]![face.axis]).toBe(3);
        const across = face.axis === 'x' ? 'y' : 'x';
        expect(pair[1]![across]).toBe(pair[0]![across]);
      }
      const mesh = objectInstance(state, cmd.object)!.inst;
      expect(mesh.scaleX).toBe(item.width);
      expect(mesh.scaleZ).toBe(2);
    }
  });
});

