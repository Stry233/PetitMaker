/**
 * The `roads` macro widened over a planting standing in the widened corridor. `widenRoads` places
 * road tiles through the executor, not `tryPlace`, and a plant is not a coating, so V-PLACE-OVERLAP
 * would refuse the tile. A standing planting therefore necks the corridor and stays, whoever placed
 * it: a press builds on a clone with an empty provenance ledger, so authorship cannot decide.
 *
 * Fixture: a one-cell landmark hub and a stall 6 cells apart (seed 3) pave a short vertical street;
 * (10,13) is a cell the width-3 dilation reaches but the width-1 core path does not.
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { CommandType, type GridState } from '../../../../core/model/types';
import { categoryOf, getCatalogByCategory } from '../../../../state/catalog';
import { applyMacro } from '../../../../tools/macros';
import { layRoadNetwork, type RoadNetworkResult } from '../../../../tools/macros/roads/roads';
import { MacroTool } from '../../../../tools/pointer/macros/macro-tool';
import { __resetCurveSession } from '../../../_support/curve-session';
import type { MacroContext } from '../../../../tools/macros/context';
import { generateObjectId } from '../../../../core/model/object-id';
import { makeState, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx } from '../../../_support/tool-ctx';
import { templateLandmarkObjects } from '../../../../core/model/landmarks';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import { cell, point } from '../../../_support/grid';
import { ItemCategory } from '../../../../config/catalog/categories';

const floraId = getCatalogByCategory(ItemCategory.Flora)[0]!.id;
const WIDEN_ONLY_CELL = { x: 10, y: 13 };

function setup(): { state: GridState; ctx: MacroContext; place: (catalogId: string, x: number, y: number, locked?: boolean) => void } {
  const state = makeState(30, 30);
  const exec = makeExecutor(state);
  const ctx: MacroContext = { state, executor: exec, registry: exec.getRegistry() };
  const place = (catalogId: string, x: number, y: number, locked = false): void => {
    const obj = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0 as const, elevation: 0, locked };
    const r = exec.execute({ type: CommandType.PlaceObject, object: obj });
    expect(r.success, `place ${catalogId}@${x},${y}`).toBe(true);
  };
  const hub = templateLandmarkObjects({ landmarks: [{ id: ANCHOR_LANDMARK.id, x: 10, y: 10, width: 1, height: 1 }] })[0]!;
  state.objects.set(hub.id, hub);
  place('building-stall', 10, 16);       // hamlet 6 cells south
  return { state, ctx, place };
}

function objectAt(state: GridState, x: number, y: number) {
  return [...state.objects.values()].find((o) => o.position.x === x && o.position.y === y);
}

describe('a wide road necks around a planting rather than mowing it', () => {
  it('leaves a planting with no authorship on record standing, and counts the cell', () => {
    const { state, ctx } = setup();
    // Set straight into state.objects, so the ledger has no authorship for it.
    const obj = { id: generateObjectId(), catalogId: floraId, position: WIDEN_ONLY_CELL, rotation: 0 as const, elevation: 0 };
    state.objects.set(obj.id, obj);

    const outcome: RoadNetworkResult = layRoadNetwork(ctx, { seed: 3, width: 3 });
    expect(outcome.laid, outcome.reason ?? '').toBeGreaterThan(0);
    expect(outcome.narrowedByPlanting).toBe(1);
    expect(state.objects.has(obj.id), 'an unauthored planting was swept').toBe(true);
    expect(objectAt(state, WIDEN_ONLY_CELL.x, WIDEN_ONLY_CELL.y)!.catalogId).toBe(floraId);
  });

  it('keeps a hand-placed planting standing and reports the narrowed cell', () => {
    const { state, ctx, place } = setup();
    place(floraId, WIDEN_ONLY_CELL.x, WIDEN_ONLY_CELL.y); // via the executor ⇒ default Human source

    const outcome: RoadNetworkResult = layRoadNetwork(ctx, { seed: 3, width: 3 });
    expect(outcome.laid, outcome.reason ?? '').toBeGreaterThan(0); // the network still landed
    expect(outcome.narrowedByPlanting).toBe(1);

    const standing = objectAt(state, WIDEN_ONLY_CELL.x, WIDEN_ONLY_CELL.y);
    expect(standing, 'the hand-placed flora was not silently removed').toBeDefined();
    expect(categoryOf(standing!)).toBe(ItemCategory.Flora);
    expect(standing!.catalogId).toBe(floraId);
  });

  // `applyMacro` builds on a scratch clone with an empty provenance ledger, unlike the two cases above.
  it('the whole-map press leaves a hand-placed planting standing at width 3', () => {
    const { state, ctx, place } = setup();
    place(floraId, WIDEN_ONLY_CELL.x, WIDEN_ONLY_CELL.y);
    const before = [...state.objects.keys()].length;

    const outcome = applyMacro(ctx, 'roads', { seed: 3, width: 3 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);

    const standing = objectAt(state, WIDEN_ONLY_CELL.x, WIDEN_ONLY_CELL.y);
    expect(standing, 'the press deleted a hand-placed plant').toBeDefined();
    expect(categoryOf(standing!)).toBe(ItemCategory.Flora);
    expect([...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Flora).length).toBe(1);
    expect([...state.objects.keys()].length).toBeGreaterThan(before);
  });
});

/**
 * A one-cell pinch anywhere along a wide road is easy to miss on the map, so the count travels from
 * `layRoadNetwork` through `tools/macros/index.ts` to a toast.
 */
describe('a necked road says so', () => {
  /** Inside the width-3 dilation of the (5,5) to (25,5) route but off its line: at y=4 or y=3 the
   *  router jogs around the plant instead and nothing necks. */
  const BESIDE_THE_LINE = { x: 15, y: 6 };
  const LINK_FROM = { x: 5, y: 5 }, LINK_TO = { x: 25, y: 5 };

  it('the whole-map press carries the count out to its caller', () => {
    const { ctx, place } = setup();
    place(floraId, WIDEN_ONLY_CELL.x, WIDEN_ONLY_CELL.y);

    const outcome = applyMacro(ctx, 'roads', { seed: 3, width: 3 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(outcome.narrowedByPlanting, 'the press knew the corridor narrowed and said nothing').toBe(1);
  });

  it('a width-1 press has nothing to report', () => {
    const { ctx, place } = setup();
    place(floraId, WIDEN_ONLY_CELL.x, WIDEN_ONLY_CELL.y);

    const outcome = applyMacro(ctx, 'roads', { seed: 3 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(outcome.narrowedByPlanting).toBeUndefined();
  });

  it('the endpoint route carries it too', () => {
    const { state, ctx, place } = setup();
    place(floraId, BESIDE_THE_LINE.x, BESIDE_THE_LINE.y);

    const outcome = applyMacro(ctx, 'road-link', { seed: 1, from: LINK_FROM, at: LINK_TO, width: 3 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(outcome.narrowedByPlanting, 'the route knew the corridor narrowed and said nothing').toBe(1);
    expect(objectAt(state, BESIDE_THE_LINE.x, BESIDE_THE_LINE.y)!.catalogId).toBe(floraId);
  });

  it('and the tool that ships it posts the toast', async () => {
    const { state, ctx, place } = setup();
    place(floraId, BESIDE_THE_LINE.x, BESIDE_THE_LINE.y);
    // Brush size 3 is the road width the drag passes (`drag-tool.ts`).
    const said: string[] = [];
    const toolCtx = makeToolCtx(state, ctx.executor as CommandExecutor, 3, 1, { armedMacro: 'road-link', notify: (text) => { said.push(text); } });
    try {
      const tool = new MacroTool();
      tool.onActivate();
      tool.onPointerDown(cell(LINK_FROM), point(LINK_FROM), toolCtx);
      tool.onPointerMove(cell(LINK_TO), point(LINK_TO), toolCtx);
      await new Promise((r) => { setTimeout(r, 0); });
      tool.onPointerUp(cell(LINK_TO), point(LINK_TO), toolCtx);
    } finally {
      __resetCurveSession();
    }
    expect(said, 'the pinch reached no one').toContain('smart.road_necked');
  });
});
