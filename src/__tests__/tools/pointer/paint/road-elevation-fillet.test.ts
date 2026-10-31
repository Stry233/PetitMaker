/**
 * A road records the surface it coats, not a neighbour's cosmetic fillet tier. A raw
 * `terrain.elevation` read sees a Γ patch's cosmetic tier as a full block, so both places that assign
 * a road's elevation read through the patch: `paint-plan.ts:planTile` (placement and the ghost's
 * preview) and `road-reconcile.ts` (re-elevating a road after nearby terrain paint). Placement
 * succeeds either way; a raw read leaves the stored elevation wrong.
 */
import { describe, it, expect } from 'vitest';
import { applyAutoEdgeCut } from '../../../../tools/trim/auto-edge-cut';
import { reconcileRoads } from '../../../../core/domain/edge-cut/road-reconcile';
import { placeTileCell } from '../../../../tools/pointer/paint/tile-coating';
import { planPaint } from '../../../../tools/pointer/paint/paint-plan';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { TerrainType, type PlacedObject } from '../../../../core/model/types';
import { getCell } from '../../../../core/model/grid-model';
import { surfaceElevation } from '../../../../core/domain/terrain/terrain-surface';
import { makeState, setTerrain, makeExecutor, reconcileArgs } from '../../../_support/map-state';
import { makeToolCtx } from '../../../_support/tool-ctx';

function exec(state: any): CommandExecutor {
  return makeExecutor(state);
}

/** A flat tier-1 plateau (4,4)-(5,5) with (4,4) wrapped by a tier-2 L, so auto-trim leaves (4,4)
 *  `patchOnly` at cosmetic tier 2 over `patchBase` 1, the surface the whole plateau shares. */
function buildFilletedPlateau(state: any, ctx: any): void {
  const wall: [number, number][] = [[3, 3], [4, 3], [3, 4]];
  const plateau: [number, number][] = [[4, 4], [5, 4], [4, 5], [5, 5]];
  for (const [x, y] of wall) setTerrain(state, x, y, TerrainType.Mountain, 2);
  for (const [x, y] of plateau) setTerrain(state, x, y, TerrainType.Mountain, 1);
  applyAutoEdgeCut(ctx, 'round', [...wall, ...plateau].map(([x, y]) => ({ x, y })), []);
}

describe('a road records the structural surface, not a fillet corners cosmetic tier', () => {
  it('planTile (fresh placement, and the ghosts own preview via planPaint) reads the real surface', () => {
    const state = makeState(10, 10);
    const executor = exec(state);
    const ctx = makeToolCtx(state, executor);
    buildFilletedPlateau(state, ctx);

    const corner = getCell(state.cells, 4, 4)!.terrain!;
    expect(corner.patchOnly).toBe(true);
    expect(corner.elevation, 'cosmetic fillet tier').toBe(2);
    expect(surfaceElevation(corner), 'the surface every plateau cell actually shares').toBe(1);

    // A click issues the same plan the ghost previews.
    const planned = planPaint([{ x: 4, y: 4 }], ctx, 'road', new Set()).commands[0];
    expect(planned?.type === 'PlaceObject' && planned.object.elevation).toBe(1);

    const painted = new Set<string>();
    expect(placeTileCell({ x: 4, y: 4 }, ctx, painted)).toBe(true);
    const road = [...state.objects.values()].find((o: any) => o.position.x === 4 && o.position.y === 4);
    expect(road).toBeDefined();
    expect((road as PlacedObject).elevation).toBe(1);
  });

  it('reconcileRoads re-elevates an already-placed road to the real surface', () => {
    const state = makeState(10, 10);
    const road: PlacedObject = { id: 'road-4-4', catalogId: 'path-overgrown-dirt', position: { x: 4, y: 4 }, rotation: 0, elevation: 0 };
    state.objects.set(road.id, road);

    const executor = exec(state);
    const ctx = makeToolCtx(state, executor);
    buildFilletedPlateau(state, ctx);
    const touched: [number, number][] = [[3, 3], [4, 3], [3, 4], [4, 4], [5, 4], [4, 5], [5, 5]];
    reconcileRoads(touched.map(([x, y]) => ({ x, y })), ...reconcileArgs(executor, state));

    const reconciled = [...state.objects.values()].find((o: any) => o.catalogId === 'path-overgrown-dirt') as PlacedObject | undefined;
    expect(reconciled, 'the road survives (its real footprint is flat)').toBeDefined();
    expect(reconciled!.elevation, 'the surface it coats, not the fillets cosmetic 2').toBe(1);
  });
});
