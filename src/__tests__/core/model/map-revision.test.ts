/** A map's edit revision moves with every edit, undo and redo; its version key moves with those and
 *  with what a rule check also reads, its layer locks and the load policy. */
import { describe, expect, it } from 'vitest';
import { mapRevisionOf, mapVersionKey } from '../../../core/model/grid-model';

const map = (cellsVersion: number, objectsVersion: number, locks: number[] = [], ignoreChunkLoad = false) =>
  ({ cellsVersion, objectsVersion, lockedLayers: new Set(locks), ignoreChunkLoad });

describe('mapRevisionOf', () => {
  it('reads both versions, and 0:0 for no map', () => {
    expect(mapRevisionOf({ cellsVersion: 3, objectsVersion: 7 })).toBe('3:7');
    expect(mapRevisionOf(null)).toBe('0:0');
  });

  it('tells a cell edit from an object edit', () => {
    expect(mapRevisionOf({ cellsVersion: 1, objectsVersion: 0 })).not.toBe(mapRevisionOf({ cellsVersion: 0, objectsVersion: 1 }));
  });
});

describe('mapVersionKey', () => {
  it('moves with the revision, a layer lock and the load policy, and with nothing else', () => {
    const base = mapVersionKey(map(1, 1));
    expect(mapVersionKey(map(1, 1))).toBe(base);
    expect(mapVersionKey(map(2, 1))).not.toBe(base);
    expect(mapVersionKey(map(1, 1, [2]))).not.toBe(base);
    expect(mapVersionKey(map(1, 1, [], true))).not.toBe(base);
    expect(mapVersionKey(map(1, 1, [2, 1]))).toBe(mapVersionKey(map(1, 1, [1, 2])));
  });

  it('starts with the edit revision, so the two never disagree about an edit', () => {
    expect(mapVersionKey(map(4, 9)).startsWith(`${mapRevisionOf(map(4, 9))}|`)).toBe(true);
  });
});
