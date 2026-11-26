/**
 * Carrying a build to another planet: what stood on the old planet stands the same way on the new
 * one, moved only by the offset between the two planets' anchors.
 */
import { describe, it, expect } from 'vitest';
import { getMapTemplate } from '../../../config/maps';
import { createGridState } from '../../../core/model/template';
import { paintTerrainCommand, placeObjectCommand } from '../../../core/model/command-build';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules';
import { createExecutor } from '../../../state/executor';
import { getCatalogItem } from '../../../state/catalog';
import { candidateObject } from '../../../tools/objects';
import { buildTransfer } from '../../../tools/generation/transfer';

const PLATEAU = { x: 34, y: 20, w: 8, h: 8 };

/** A map on `planetId` with a one-layer plateau and a ramp placed against each of its four edges,
 *  each pressed on the plateau's edge cell as a person would. */
function rampsOn(planetId: string, item: string): { state: GridState; ramps: PlacedObject[] } {
  const state = createGridState(getMapTemplate(planetId));
  const executor = createExecutor(state, createDefaultRegistry());
  const cells: MacroCoord[] = [];
  for (let y = PLATEAU.y; y < PLATEAU.y + PLATEAU.h; y++)
    for (let x = PLATEAU.x; x < PLATEAU.x + PLATEAU.w; x++) cells.push({ x, y });
  expect(executor.execute(paintTerrainCommand(cells, TerrainType.Mountain, 1)).success).toBe(true);
  const midX = PLATEAU.x + PLATEAU.w / 2, midY = PLATEAU.y + PLATEAU.h / 2;
  const presses: MacroCoord[] = [
    { x: midX, y: PLATEAU.y + PLATEAU.h - 1 },
    { x: midX, y: PLATEAU.y },
    { x: PLATEAU.x + PLATEAU.w - 1, y: midY },
    { x: PLATEAU.x, y: midY },
  ];
  const ramps = presses.map((at, i) => {
    const ramp = candidateObject(getCatalogItem(item)!, at, 0, state, { id: `ramp-${i}` });
    expect(executor.execute(placeObjectCommand(ramp)).success).toBe(true);
    return state.objects.get(ramp.id)!;
  });
  expect(new Set(ramps.map((r) => r.rotation)).size).toBe(4);
  return { state, ramps };
}

describe('a carried build arrives as it stood', () => {
  for (const item of ['ramp-park-steps', 'ramp-plank']) {
    it(`[PLAN-24] keeps every ${item} against its cliff, turned as it was`, () => {
      const { state, ramps } = rampsOn('hexia', item);
      const { dest, offset, dropped } = buildTransfer(state, getMapTemplate('tafa'));
      expect(dropped.objects).toBe(0);
      for (const ramp of ramps) {
        const arrived = dest.objects.get(ramp.id);
        expect(arrived && { position: arrived.position, rotation: arrived.rotation, elevation: arrived.elevation }).toEqual({
          position: { x: ramp.position.x + offset.x, y: ramp.position.y + offset.y },
          rotation: ramp.rotation,
          elevation: ramp.elevation,
        });
      }
    });
  }
});
