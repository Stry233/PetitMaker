import { describe, expect, it } from 'vitest';
import { mapRevisionOf } from '../../state/map-revision';

describe('mapRevisionOf', () => {
  it('reads both versions, and 0:0 for no map', () => {
    expect(mapRevisionOf({ cellsVersion: 3, objectsVersion: 7 })).toBe('3:7');
    expect(mapRevisionOf(null)).toBe('0:0');
  });

  it('tells a cell edit from an object edit', () => {
    expect(mapRevisionOf({ cellsVersion: 1, objectsVersion: 0 })).not.toBe(mapRevisionOf({ cellsVersion: 0, objectsVersion: 1 }));
  });
});
