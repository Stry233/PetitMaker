/**
 * The `roads` macro widened, over a planting already standing in the widened corridor.
 *
 * `widenRoads` dilates each road tile the router laid into a `width`-sized block by placing new
 * road objects directly — unlike `tryDecorate`/`tryPlace` in `tools/placement/object.ts`,
 * it never goes through the populator's own overlap/authorship gates. A tree or flower is not a
 * coating, so V-PLACE-OVERLAP refuses the road tile outright and an unguarded place would just fail
 * there: a hole in the pavement with the plant standing in the middle of a wide street.
 *
 * A standing planting therefore NECKS the corridor and stays where it stands, whoever placed it and
 * whatever the ledger knows — and the third case is why it cannot be an authorship question: a press
 * builds on a detached clone whose ledger is empty, so "spare the human-authored ones" spared none.
 *
 * Fixture: two locked-hub/hamlet stalls 6 cells apart on an empty flat map (seed 3), which pave a
 * short vertical street; (10,13) is a cell the width-3 dilation reaches but the width-1 core path
 * does not (confirmed empirically against this fixture — see the scenarios below).
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { CommandType, ItemCategory, type EditorEvents, type GridState } from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';
import { categoryOf, getCatalogByCategory } from '../../../state/catalog';
import { applyMacro } from '../../../tools/macros';
import { layRoadNetwork, type RoadNetworkResult } from '../../../tools/macros/roads';
import { MacroTool } from '../../../tools/macros/macro-tool';
import { __resetCurveSession } from '../../../tools/paint/curve-session';
import { setToastPresenter } from '../../../core/runtime/toast-bus';
import type { MacroContext } from '../../../tools/macros/context';
import { generateObjectId } from '../../../core/model/object-id';
import { makeState } from '../../rules/_helpers';
import { makeToolCtx } from '../_tool-ctx';
import { createDefaultRegistry } from '../../../rules/index';

const floraId = getCatalogByCategory(ItemCategory.Flora)[0]!.id;
const WIDEN_ONLY_CELL = { x: 10, y: 13 };

function setup(): { state: GridState; ctx: MacroContext; place: (catalogId: string, x: number, y: number, locked?: boolean) => void } {
  const state = makeState(30, 30);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const ctx: MacroContext = { state, executor: exec, registry: exec.getRegistry() };
  const place = (catalogId: string, x: number, y: number, locked = false): void => {
    const obj = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0 as const, elevation: 0, locked };
    const r = exec.execute({ type: CommandType.PlaceObject, timestamp: 1, object: obj, loadValue: 0 });
    expect(r.success, `place ${catalogId}@${x},${y}`).toBe(true);
  };
  place('building-stall', 10, 10, true); // locked hub
  place('building-stall', 10, 16);       // hamlet 6 cells south
  return { state, ctx, place };
}

function objectAt(state: GridState, x: number, y: number) {
  return [...state.objects.values()].find((o) => o.position.x === x && o.position.y === y);
}

describe('a wide road necks around a planting rather than mowing it', () => {
  it('leaves a planting with no authorship on record standing, and counts the cell', () => {
    const { state, ctx } = setup();
    // Placed directly onto state.objects, bypassing the executor: the same "no authorship on
    // record" shape a generated map's own un-authored planting has.
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

  // THE PATH A PRESS TAKES. `applyMacro` builds on a scratch clone with its own empty provenance
  // ledger, so a spare that asked the ledger whether this plant was hand-placed spared nothing here
  // and the press deleted it. Driving the widen through the tool the shelf runs is the only way to
  // see that; the two cases above run on the live executor, where the ledger was intact.
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
 * AND THE USER IS TOLD. Above width 1 the neck is the NORMAL outcome, not a corner: the count was
 * measured, reported by `layRoadNetwork`, and then dropped on the floor by `tools/macros/index.ts`,
 * so someone asked for a 3-wide road, got a 1-wide pinch in the middle of it and heard nothing. The
 * pinch is not something the map can show for itself either — the press is made from the bar, the
 * pinch can be anywhere along the route, and a road that is 3 wide except at one cell reads as a
 * road that is 3 wide.
 */
describe('a necked road says so', () => {
  /** Beside the corridor a width-3 route from (5,5) to (25,5) dilates into, and clear of the line
   *  itself: at y=4 or y=3 the router jogs around the plant instead and nothing necks. */
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
    // The bar's own width, which is where a road macro's width comes from (`MacroTool.linkOpts`).
    const toolCtx = makeToolCtx(state, ctx.executor as CommandExecutor, 3, 1, { armedMacro: 'road-link' });
    const said: string[] = [];
    const stop = setToastPresenter((text) => { said.push(text); });
    try {
      const tool = new MacroTool();
      tool.onActivate();
      tool.onPointerDown(LINK_FROM, LINK_FROM, toolCtx);
      tool.onPointerMove(LINK_TO, LINK_TO, toolCtx);
      await new Promise((r) => { setTimeout(r, 0); });
      tool.onPointerUp(LINK_TO, LINK_TO, toolCtx);
    } finally {
      stop();
      __resetCurveSession();
    }
    expect(said, 'the pinch reached no one').toContain('smart.road_necked');
  });
});
