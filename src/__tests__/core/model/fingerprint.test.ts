import { describe, expect, it } from 'vitest';
import { stampMap, stillStamped } from '../../../core/model/fingerprint';
import { paintTerrainCommand } from '../../../core/model/command-build';
import { TerrainType } from '../../../core/model/types';
import { makeExecutor, makeState } from '../../_support/map-state';

describe('map stamps', () => {
  it('holds while nothing is edited, breaks on an edit and holds again once it is undone', () => {
    const state = makeState(12, 12);
    const executor = makeExecutor(state);
    const stamp = stampMap(state);
    expect(stillStamped(state, stamp)).toBe(true);

    expect(executor.execute(paintTerrainCommand([{ x: 4, y: 4 }], TerrainType.Mountain, 1)).success).toBe(true);
    expect(stillStamped(state, stamp)).toBe(false);

    executor.undo();
    expect(stillStamped(state, stamp)).toBe(true);
  });

  it('never vouches for another map whose counters happen to match', () => {
    const first = makeState(12, 12);
    const stamp = stampMap(first);
    const replaced = makeState(12, 12);
    makeExecutor(replaced).execute(paintTerrainCommand([{ x: 4, y: 4 }], TerrainType.Mountain, 1));
    first.cellsVersion = replaced.cellsVersion;
    first.objectsVersion = replaced.objectsVersion;
    const sameKey = stampMap(first);
    expect(stillStamped(replaced, sameKey)).toBe(false);
    expect(stillStamped(makeState(12, 12), stamp)).toBe(false);
  });
});
