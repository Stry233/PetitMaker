/**
 * The history's aside lane: a value the executor carries beside the map (the editor's selection),
 * whose own steps interleave with the map's. The property held: walking the history back and forth
 * visits exactly the (map, aside) pairs the edits passed through, whatever order the two kinds of
 * step came in, and the map depth never counts an aside step.
 */
import { describe, it, expect } from 'vitest';
import { TerrainType } from '../../../core/model/types';
import { mapFingerprint } from '../../../core/model/fingerprint';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import { bareExecutor } from '../../_support/kernel';
import { makeState, paintCmd } from '../../_support/map-state';

/** An aside holding one string, as the store holds the selection. */
function withAside(executor: CommandExecutor) {
  let value = '';
  executor.attachAside<string>({ read: () => value, write: (v) => { value = v; }, same: (a, b) => a === b });
  return {
    get: () => value,
    /** A change the user makes: one step. */
    set: (next: string) => { const before = value; value = next; executor.recordAside(before); },
    /** A change no step records, as arming another tool puts the selection down. */
    drop: (next: string) => { value = next; },
  };
}

const paint = (executor: CommandExecutor, x: number) => {
  executor.transaction({}, (tx) => { executor.execute(paintCmd([{ x, y: 1 }], TerrainType.Mountain, 1)); tx.commit(); });
};

describe('the history aside', () => {
  it('walks back and forth through every (map, aside) pair the steps passed through', () => {
    const state = makeState(8, 8);
    const executor = bareExecutor(state);
    const aside = withAside(executor);
    const seen: [string, string][] = [];
    const now = (): [string, string] => [mapFingerprint(state), aside.get()];
    seen.push(now());
    aside.set('a'); seen.push(now());
    paint(executor, 1); seen.push(now());
    aside.set('b'); seen.push(now());
    aside.set('c'); seen.push(now());
    paint(executor, 2); seen.push(now());
    paint(executor, 3); seen.push(now());
    expect(executor.historyDepth(), 'the depth counts map entries alone').toBe(3);
    for (let i = seen.length - 2; i >= 0; i--) {
      expect(executor.undo()).toBe(true);
      expect(now()).toEqual(seen[i]);
    }
    expect(executor.canUndo()).toBe(false);
    for (let i = 1; i < seen.length; i++) {
      expect(executor.redo()).toBe(true);
      expect(now()).toEqual(seen[i]);
    }
    expect(executor.canRedo()).toBe(false);
  });

  it('passes over a step a later unrecorded change already took back', () => {
    const state = makeState(8, 8);
    const executor = bareExecutor(state);
    const aside = withAside(executor);
    paint(executor, 1);
    aside.set('a');
    aside.drop('');
    expect(executor.undo()).toBe(true);
    expect(executor.historyDepth(), 'the undo reached the paint').toBe(0);
    expect(executor.canUndo()).toBe(false);
  });

  it('undoEdit takes back one map entry with the aside steps above it', () => {
    const state = makeState(8, 8);
    const executor = bareExecutor(state);
    const aside = withAside(executor);
    aside.set('a');
    paint(executor, 1);
    aside.set('b');
    aside.set('c');
    expect(executor.undoEdit()).toBe(true);
    expect(executor.historyDepth()).toBe(0);
    expect(aside.get()).toBe('a');
    expect(executor.redoEdit()).toBe(true);
    expect(executor.historyDepth()).toBe(1);
    expect(executor.undoEdit()).toBe(true);
    expect(executor.undoEdit(), 'only an aside step is left').toBe(false);
  });

  it('keeps a step recorded inside an open stroke once the stroke folds into one entry', () => {
    const state = makeState(8, 8);
    const executor = bareExecutor(state);
    const aside = withAside(executor);
    executor.transaction({}, (tx) => {
      executor.execute(paintCmd([{ x: 1, y: 1 }], TerrainType.Mountain, 1));
      aside.set('a');
      executor.execute(paintCmd([{ x: 2, y: 1 }], TerrainType.Mountain, 1));
      tx.commit();
    });
    expect(executor.historyDepth()).toBe(1);
    expect(executor.undo()).toBe(true);
    expect(aside.get()).toBe('');
    expect(executor.historyDepth(), 'the aside step came off first').toBe(1);
    expect(executor.undo()).toBe(true);
    expect(executor.historyDepth()).toBe(0);
  });

  it('returns to a mark with the aside steps it held', () => {
    const state = makeState(8, 8);
    const executor = bareExecutor(state);
    const aside = withAside(executor);
    aside.set('a');
    const mark = executor.markHistory();
    aside.set('b');
    paint(executor, 1);
    executor.returnTo(mark);
    aside.drop('a');
    expect(executor.undo()).toBe(true);
    expect(aside.get()).toBe('');
    expect(executor.canUndo()).toBe(false);
  });

  it('a restored save history carries no aside step', () => {
    const state = makeState(8, 8);
    const executor = bareExecutor(state);
    const aside = withAside(executor);
    paint(executor, 1);
    aside.set('a');
    executor.restoreHistory(executor.getUndoEntries());
    expect(executor.getUndoEntries()).toHaveLength(1);
    executor.undo();
    expect(executor.historyDepth(), 'the first undo takes the paint back').toBe(0);
  });
});
