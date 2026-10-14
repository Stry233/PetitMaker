/** The roads press joins houses to a plaza standing on a plate no larger than itself, one tier up. */
import { describe, expect, it } from 'vitest';
import { createGridState } from '../../../../core/model/template';
import { MAP_LIST } from '../../../../config/maps';
import { makeExecutor } from '../../../_support/map-state';
import { createDefaultRegistry } from '../../../../rules/index';
import { applyMacro } from '../../../../tools/macros/run';
import { networkCells } from '../../../../tools/macros/roads/walkable';
import { components } from '../../../../core/grid/cell-sets';
import { makeCtx, tryPlace } from '../../../../tools/placement/object';
import { categoryOf, getPlaceableByCategory } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { templateLandmark } from '../../../../core/model/landmarks';
import { terrainCellsUnder } from '../../../../core/grid/footprint';
import { isBuildableZone } from '../../../../core/game/zones';
import type { GridState, PlacedObject } from '../../../../core/model/types';
import { makeRng } from '../../../../core/base/rng';
import { ItemCategory } from '../../../../config/catalog/categories';

type Rect = { x: number; y: number; w: number; h: number };

/** The network pieces within `pad` cells of `rect`: pavement, decks and each deck's apron. */
function piecesAround(comp: Map<number, number>, rect: Rect, W: number, pad: number): Set<number> {
  const out = new Set<number>();
  for (let y = Math.floor(rect.y) - pad; y <= Math.ceil(rect.y + rect.h) + pad - 1; y++) {
    for (let x = Math.floor(rect.x) - pad; x <= Math.ceil(rect.x + rect.w) + pad - 1; x++) {
      const c = comp.get(y * W + x);
      if (c !== undefined) out.add(c);
    }
  }
  return out;
}

const houses = (state: GridState): PlacedObject[] => [...state.objects.values()]
  .filter((o) => !o.locked && categoryOf(o) === ItemCategory.Building);

function expectJoinedToPlaza(state: GridState): void {
  const W = state.template.width, H = state.template.height;
  const comp = components(networkCells(state, W, H, { aprons: true }).cells, W, H);
  const plaza = templateLandmark(state)!;
  const plazaPieces = piecesAround(comp, objectRect(plaza), W, 1);
  expect(plazaPieces.size, 'no pavement reaches the plaza').toBeGreaterThan(0);
  for (const h of houses(state)) {
    const shared = [...piecesAround(comp, objectRect(h), W, 2)].some((c) => plazaPieces.has(c));
    expect(shared, `${h.catalogId}@${h.position.x},${h.position.y} is not on the plaza's own network`).toBe(true);
  }
}

describe('roads on the built-in planets', () => {
  for (const template of MAP_LIST) {
    it(`join ${template.id}'s houses to the plaza standing on its layer-1 mountain, and a re-press keeps them`, () => {
      const registry = createDefaultRegistry();
      const state = createGridState(template);
      const plaza = templateLandmark(state)!;
      const ground = terrainCellsUnder(objectRect(plaza)).map((c) => state.cells[c.y]![c.x]!.terrain?.elevation ?? 0);
      expect(Math.min(...ground), 'the plaza stands on layer-1 ground').toBe(1);

      const executor = makeExecutor(state, registry);
      const kit = { state, executor, registry };
      const pool = getPlaceableByCategory(ItemCategory.Building).filter((b) => b.width * b.height >= 4);
      const place = makeCtx(state, (c) => executor.execute(c), registry, 3);
      const rng = makeRng(3);
      let laid = 0;
      for (let t = 0; t < 4000 && laid < 4; t++) {
        const x = 8 + rng.int(150), y = 8 + rng.int(120);
        if (!isBuildableZone(state.cells[y]?.[x]?.zone ?? 0)) continue;
        if (tryPlace(place, pool[rng.int(pool.length)]!.id, x, y, 0)) laid++;
      }
      expect(laid).toBe(4);

      const roads = applyMacro(kit, 'roads', { seed: 4 });
      expect(roads.code, roads.reason ?? '').toBeUndefined();
      expect(roads.changes).toBeGreaterThan(0);
      const ramps = [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Ramp);
      expect(ramps.length, 'a ramp climbs onto the plaza').toBeGreaterThan(0);
      expectJoinedToPlaza(state);

      const again = applyMacro(kit, 'roads', { seed: 5 });
      expect(again.changes, again.reason ?? '').toBe(0);
      expect(again.code).toBe('already-connected');

      const other = applyMacro(kit, 'roads', { seed: 6, replace: roads.ownedIds ?? [] });
      expect(other.changes, other.reason ?? '').toBeGreaterThan(0);
      expectJoinedToPlaza(state);
    });
  }
});
