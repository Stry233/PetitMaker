/** Where a paste that did not fit looks for room (EDIT-57): nearest first, its own layer preferred a few cells further. */
import { describe, expect, it } from 'vitest';
import { makeState } from '../../_support/map-state';
import { nearestRoom, roomAround } from '../../../tools/objects/arrangement';

describe('the room a paste looks for', () => {
  it('lists places on the map nearest first, ties in reading order, the aimed one left out', () => {
    const places = [...roomAround(makeState(10, 10), { x: 0, y: 0 }, 2, 2, 2)];
    expect(places).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 0 }, { x: 0, y: 2 }]);
  });

  it('keeps every place whose outline stays on the map within the reach', () => {
    const state = makeState(30, 20);
    const places = [...roomAround(state, { x: 12, y: 8 }, 3, 2, 60)];
    expect(places).toHaveLength(28 * 19 - 1);
    expect(new Set(places.map((p) => `${p.x},${p.y}`)).size).toBe(places.length);
  });

  it('prefers room on its own layer a few cells past room on another, and no further', () => {
    const line = Array.from({ length: 40 }, (_, i) => ({ x: i + 1, y: 0 }));
    const from = { x: 0, y: 0 };
    const fit = (own: number) => (p: { x: number }) => (p.x === 3 ? { level: 1, x: p.x } : p.x === own ? { level: 0, x: p.x } : null);
    expect(nearestRoom(line, from, 0, fit(9))?.x).toBe(9);
    expect(nearestRoom(line, from, 0, fit(30))?.x).toBe(3);
    expect(nearestRoom(line, from, 0, () => null)).toBeNull();
  });
});
