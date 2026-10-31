/** `CommandExecutor.returnTo`: back to a marked history from wherever undo, redo and new edits took it. */
import { describe, it, expect } from 'vitest';
import { TerrainType } from '../../../core/model/types';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { bareExecutor } from '../../_support/kernel';
import { makeState, paintCmd } from '../../_support/map-state';

const paint = (executor: ReturnType<typeof bareExecutor>, x: number, y: number) => {
  executor.transaction({}, (tx) => { executor.execute(paintCmd([{ x, y }], TerrainType.Mountain, 1)); tx.commit(); });
};

describe('returning to a marked history', () => {
  it('restores the map, the undo depth and the redo, whatever ran after the mark', () => {
    const state = makeState(8, 8);
    const executor = bareExecutor(state);
    paint(executor, 1, 1);
    paint(executor, 2, 2);
    const afterBoth = mapFingerprint(state);
    executor.undo();
    const marked = mapFingerprint(state);
    const mark = executor.markHistory();
    executor.undo();
    paint(executor, 5, 5);
    paint(executor, 6, 6);
    expect(mapFingerprint(state)).not.toBe(marked);
    expect(executor.returnTo(mark)).toBe(true);
    expect(mapFingerprint(state)).toBe(marked);
    expect(executor.historyDepth()).toBe(1);
    executor.redo();
    expect(mapFingerprint(state)).toBe(afterBoth);
  });

  it('changes nothing for a mark another executor took', () => {
    const state = makeState(8, 8);
    const executor = bareExecutor(state);
    const foreign = bareExecutor(makeState(8, 8)).markHistory();
    paint(executor, 1, 1);
    const painted = mapFingerprint(state);
    expect(executor.returnTo(foreign)).toBe(false);
    expect(mapFingerprint(state)).toBe(painted);
    expect(executor.historyDepth()).toBe(1);
  });
});
