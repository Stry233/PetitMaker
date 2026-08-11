/**
 * V-PLACE-COATED — nothing stands on a road.
 *
 * The backstop for a caller that puts an object on coated cells without stripping the coating
 * first. It cannot be a pre-command rule: V-PLACE-OVERLAP exempts coatings precisely so a road
 * never blocks a placement, because the same validation answers the placement ghost's pre-click
 * probe, when the road is still there and the click is still legal. Only the finished stroke can
 * tell "coated over" from "left standing on".
 */
import { describe, it, expect } from 'vitest';
import { objectOnCoatingRule } from '../../rules/object-on-coating';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import type { EditorEvents, GridState, PlacedObject } from '../../core/model/types';
import { makeState, placeCmd } from './_helpers';
import { roadLookup } from '../../state/object-index';

function withObjects(...objs: PlacedObject[]): GridState {
  const state = makeState(20, 20);
  for (const o of objs) state.objects.set(o.id, o);
  bumpObjectsVersion(state, { added: objs });
  return state;
}

const at = (id: string, catalogId: string, x: number, y: number): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation: 0, elevation: 0 });

describe('V-PLACE-COATED: nothing stands on a road', () => {
  it('passes on a map with no roads at all', () => {
    expect(objectOnCoatingRule.validate(withObjects(at('t', 'tree-apple', 3, 3)))).toEqual([]);
  });

  it('passes when the object and the road are on different cells', () => {
    const state = withObjects(at('r', 'road-dirt', 3, 3), at('t', 'tree-apple', 7, 7));
    expect(objectOnCoatingRule.validate(state)).toEqual([]);
  });

  it('reports the covered cells when an object stands on a road', () => {
    const state = withObjects(at('r', 'road-dirt', 4, 4), at('t', 'tree-apple', 4, 4));
    const errors = objectOnCoatingRule.validate(state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ruleId).toBe('V-PLACE-COATED');
    expect(errors[0]!.cells).toEqual([{ x: 4, y: 4 }]);
  });

  it('exempts a crossing, whose deck is paved across on purpose', () => {
    // The generator routes the street bank-to-bank OVER a bridge; a road on those cells is the
    // intended arrangement, so flagging it would revert every generation that builds one.
    const state = withObjects(at('r', 'road-dirt', 5, 5), at('b', 'bridge-plank', 5, 5));
    expect(objectOnCoatingRule.validate(state)).toEqual([]);
  });

  it('exempts a road over a road, which is the brush repainting', () => {
    const state = withObjects(at('r1', 'road-dirt', 6, 6), at('r2', 'road-stone', 6, 6));
    expect(objectOnCoatingRule.validate(state)).toEqual([]);
  });

  it('passes once the coating under the object is gone', () => {
    const state = withObjects(at('r', 'road-dirt', 4, 4), at('t', 'tree-apple', 4, 4));
    expect(objectOnCoatingRule.validate(state)).toHaveLength(1);

    const road = state.objects.get('r')!;
    state.objects.delete('r');
    bumpObjectsVersion(state, { removed: [road] });

    expect(objectOnCoatingRule.validate(state)).toEqual([]);
  });

  it('reverts a real stroke that placed an object on a road without stripping it', () => {
    // The end-to-end point of the rule: a caller that forgets the strip gets its stroke undone
    // rather than leaving a map the game cannot build. Nothing refuses the commands themselves —
    // V-PLACE-OVERLAP exempts the road — so this is the only thing standing between a forgotten
    // strip and an illegal map.
    const state = makeState(20, 20);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    expect(executor.execute(placeCmd(at('r', 'road-dirt', 4, 4))).success).toBe(true);
    executor.commitStroke(executor.getUndoStackSize() - 1);

    const strokeStart = executor.getUndoStackSize();
    // Accepted on its own: the overlap rule lets an object sit over a coating on purpose.
    expect(executor.execute(placeCmd(at('t', 'tree-apple', 4, 4))).success).toBe(true);
    const violations = executor.commitStroke(strokeStart);

    expect(violations.map((v) => v.ruleId)).toContain('V-PLACE-COATED');
    expect(state.objects.has('t')).toBe(false); // reverted
    expect(state.objects.has('r')).toBe(true);  // the road that was there all along survives
  });

  it('answers firstOnly without sweeping the whole map', () => {
    const state = withObjects(
      at('r1', 'road-dirt', 1, 1), at('t1', 'tree-apple', 1, 1),
      at('r2', 'road-dirt', 9, 9), at('t2', 'tree-apple', 9, 9),
    );
    expect(objectOnCoatingRule.validate(state, { firstOnly: true })).toHaveLength(1);
    // The full sweep still names every offending cell, so the flash covers both.
    expect(objectOnCoatingRule.validate(state)[0]!.cells).toHaveLength(2);
  });
});
