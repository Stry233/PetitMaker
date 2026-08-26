/**
 * A road coats the surface it sits on, not a neighbour's cosmetic fillet.
 *
 * `core/edge-cut/terrain-silhouette.ts` warns that a raw `terrain.elevation` read sees a Γ patch's
 * cosmetic tier as a full block (phantom-block). Both places that assign a tile/road's OWN
 * elevation were reading raw: `paint-plan.ts:planTile` (fresh placement — also the ghost's own
 * preview, since the ghost reuses `planPaint`) and `road-reconcile.ts` (re-elevating an existing
 * road after a nearby terrain paint). A flat plateau with one corner filleted by a taller
 * neighbour (AUTO-TRIM-IS-COSMETIC: the fillet rests one tier above what it decorates,
 * `patchBase`) is common and entirely legal ground for a road — the flat-trait rule already reads
 * through the structural surface, so placement succeeds; only the STORED elevation was wrong,
 * which is what both 2D and 3D render directly (`object-meshes.ts`: `surfaceY(obj.elevation)`),
 * so the road rendered one tier above the ground around it.
 */
import { describe, it, expect } from 'vitest';
import { applyAutoEdgeCut } from '../../../tools/edge-cut/auto-edge-cut';
import { reconcileRoads } from '../../../core/commands/road-reconcile';
import { placeTileCell } from '../../../tools/paint/tile-coating';
import { planPaint } from '../../../tools/paint/paint-plan';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { TerrainType, type EditorEvents, type PlacedObject } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { surfaceElevation } from '../../../core/edge-cut/terrain-silhouette';
import { makeState, setTerrain } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import { roadLookup } from '../../../state/object-index';

function exec(state: any): CommandExecutor {
  return new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
}

/** A flat tier-1 plateau (4,4)-(5,5), one corner (4,4) wrapped by a taller tier-2 L — the exact
 *  fixture from auto-edge-cut.test.ts's "rounds a lower real block in a Γ notch" case, sized so
 *  the plateau covers a 2x2 road footprint. (4,4) ends up `patchOnly` at cosmetic tier 2 with
 *  `patchBase` 1: the real surface every cell of the plateau (including (4,4)) actually shares. */
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

    // The plan a click issues IS the ghost's own preview (planPaint), so the two cannot disagree.
    const planned = planPaint([{ x: 4, y: 4 }], ctx, 'tile', new Set()).commands[0];
    expect(planned?.type === 'PlaceObject' && planned.object.elevation).toBe(1);

    const painted = new Set<string>();
    expect(placeTileCell({ x: 4, y: 4 }, ctx, painted)).toBe(true);
    const road = [...state.objects.values()].find((o: any) => o.position.x === 4 && o.position.y === 4);
    expect(road).toBeDefined();
    // Render-facing: object-meshes.ts draws every object at `surfaceY(obj.elevation)` directly, so
    // this stored field IS the rendered height — a wrong value here is a floating road, not a
    // cosmetic label.
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
    reconcileRoads(touched.map(([x, y]) => ({ x, y })), state, executor);

    const reconciled = [...state.objects.values()].find((o: any) => o.catalogId === 'path-overgrown-dirt') as PlacedObject | undefined;
    expect(reconciled, 'the road survives (its real footprint is flat)').toBeDefined();
    expect(reconciled!.elevation, 'the surface it coats, not the fillets cosmetic 2').toBe(1);
  });
});
