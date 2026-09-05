/**
 * Drag-to-move on a SNAPPING item (bridge/ramp): the drop must re-detect the span at the
 * destination, orientation included — the waterSpan/heightDrop traits MUTATE the command's
 * position/rotation during validation, so planning the drop against the real command and then
 * re-validating it in `executor.execute` snaps twice: the second detection runs from the
 * already-snapped anchor, where there is no cliff or gap to find, and a legal drop is refused
 * with the object already lifted. The same double-snap `object-placer-bridge-ramp` pins on the
 * placement path, here on the drag path. The sequence here is the pointer machine's own drop
 * sequence.
 */
import { describe, it, expect } from 'vitest';
import { planObjectMove, removeObjectCommand, stripCoatingsFor } from '../../../tools/objects/object-placer';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { CommandType, TerrainType, CellZone, type EditorEvents, type GridState, type PlacedObject } from '../../../core/model/types';
import { makeState, setTerrain, setZone } from '../../rules/_helpers';
import { roadLookup } from '../../../state/object-index';

const exec = (s: GridState) => new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(s));

/** Place `catalogId` by anchor through the executor, letting the trait snap it. */
function place(executor: CommandExecutor, state: GridState, catalogId: string, x: number, y: number): PlacedObject {
  const res = executor.execute({
    type: CommandType.PlaceObject, timestamp: 0,
    object: { id: `t-${catalogId}`, catalogId, position: { x, y }, rotation: 0, elevation: 0 },
    loadValue: 0,
  });
  expect(res.success, `${catalogId} placed`).toBe(true);
  return state.objects.get(`t-${catalogId}`)!;
}

/** The pointer machine's drop sequence, verbatim: plan, lift, coat over, place, commit. */
function drop(executor: CommandExecutor, state: GridState, obj: PlacedObject, x: number, y: number): void {
  const { cmd, errors } = planObjectMove(executor, state, obj, x, y);
  expect(errors, 'the drop plan accepted the destination').toEqual([]);
  const start = executor.getUndoStackSize();
  executor.execute(removeObjectCommand(obj));
  stripCoatingsFor(executor, state, cmd.object);
  executor.execute(cmd);
  executor.commitStroke(start);
}

describe('dragging a snapping object re-snaps its orientation at the drop', () => {
  it('a ramp dragged from a north-facing cliff to a south-facing one turns to 180', () => {
    const S = 24; const state = makeState(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      setZone(state, x, y, CellZone.Grass);
      if (y <= 4 || y >= 19) setTerrain(state, x, y, TerrainType.Mountain, 1);
    }
    const ex = exec(state);
    const ramp = place(ex, state, 'ramp-teak-stair', 8, 5);
    expect(ramp.rotation).toBe(0);

    drop(ex, state, ramp, 8, 18);
    const moved = state.objects.get(ramp.id);
    expect(moved, 'the ramp survived the drop').toBeTruthy();
    expect(moved!.rotation, 'orientation re-detected at the destination').toBe(180);
    expect(moved!.position).toEqual({ x: 8, y: 15 });
  });

  it('a bridge dragged from a vertical gorge to a horizontal one turns with it', () => {
    // A level-1 plateau with two ground-level trenches: a bridge spans lower terrain the same as
    // water, and terrain keeps the whole state legal under the drop's own commitStroke.
    const S = 24; const state = makeState(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      setZone(state, x, y, CellZone.Grass);
      const trench = (x >= 10 && x <= 12 && y >= 2 && y < 10) || (y >= 16 && y <= 18 && x >= 2 && x < 10);
      if (!trench) setTerrain(state, x, y, TerrainType.Mountain, 1);
    }
    const ex = exec(state);
    const bridge = place(ex, state, 'bridge-teak', 11, 5);
    const before = state.objects.get(bridge.id)!;
    expect(before.rotation).toBe(0);

    drop(ex, state, before, 5, 17);
    const moved = state.objects.get(bridge.id);
    expect(moved, 'the bridge survived the drop').toBeTruthy();
    expect(moved!.rotation, 'orientation re-detected at the destination').toBe(90);
  });

  it('a ramp dragged onto a half-offset cliff lands at the half anchor', () => {
    // The drop anchor goes through snapAnchor too, so a halfStep item can land on the
    // half grid at the destination, not only where it started. Same lane as
    // half-step-detection.test.ts's case (a): a mountain shoulder at x = 7 and a water bank at
    // x = 4 leave a lane exactly the ramp's width — only the HALF anchor at x = 4.5 clears it.
    const S = 24; const state = makeState(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      setZone(state, x, y, CellZone.Grass);
      if (y <= 9) setTerrain(state, x, y, TerrainType.Mountain, 1);
    }
    for (let y = 10; y <= 14; y++) {
      setTerrain(state, 7, y, TerrainType.Mountain, 1);
      setTerrain(state, 4, y, TerrainType.Water, 0);
    }
    const ex = exec(state);
    // Placed at a whole anchor elsewhere on the same cliff line, where the lane is unobstructed.
    const ramp = place(ex, state, 'ramp-teak-stair', 15, 10);
    expect(ramp.position).toEqual({ x: 15, y: 9 });

    drop(ex, state, ramp, 4.5, 10);
    const moved = state.objects.get(ramp.id);
    expect(moved, 'the ramp survived the drop').toBeTruthy();
    expect(moved!.position).toEqual({ x: 4.5, y: 9 });
    expect(moved!.rotation).toBe(0);
  });
});
