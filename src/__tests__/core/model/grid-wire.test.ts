/**
 * The worker-boundary cell encoding: six bytes per cell, and the decode is the encode undone.
 *
 * The load-bearing fact is fingerprint parity: a worker computes `mapFingerprint` over the
 * revived grid and the main thread compares it against the live one, so any field the codec
 * dropped or invented would make every off-thread build land as "stale" and silently fall back
 * to the main thread — the exact cost the codec exists to remove.
 */
import { describe, it, expect } from 'vitest';
import { decodeCells, decodeGridState, encodeCells, encodeGridState } from '../../../core/model/grid-wire';
import { TerrainType, type Corners } from '../../../core/model/types';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { makeState, setTerrain } from '../../_support/map-state';

describe('grid wire', () => {
  it('round-trips every terrain shape, fingerprint-identical', () => {
    const state = makeState(12, 12);
    setTerrain(state, 2, 2, TerrainType.Mountain, 3);
    setTerrain(state, 3, 2, TerrainType.Water, 2);
    setTerrain(state, 4, 2, TerrainType.Mountain, 8);
    const fancy = state.cells[2]![4]!.terrain!;
    fancy.corners = ['fan', 'square', 'tri-NW', 'empty'] as Corners;
    fancy.patchOnly = true;
    fancy.patchBase = 0;   // present-and-zero is not absent: the fingerprint tells them apart
    const island = state.cells[5]![5]!;
    island.terrain = { type: TerrainType.None, elevation: 0, corners: ['tri-SE', 'square', 'square', 'square'] as Corners };

    const decoded = decodeCells(encodeCells(state.cells, 12, 12));
    expect(decoded).toEqual(state.cells);

    const revived = { ...state, cells: decoded };
    expect(mapFingerprint(revived)).toBe(mapFingerprint(state));
  });

  it('round-trips a whole grid with its objects, locks and versions against the template it names', () => {
    const state = makeState(12, 12);
    setTerrain(state, 2, 2, TerrainType.Mountain, 3);
    state.objects.set('t1', { id: 't1', catalogId: 'tree-apple', position: { x: 4, y: 4 }, rotation: 0, elevation: 0 });
    state.lockedLayers.add(2);
    state.cellsVersion = 7;
    state.objectsVersion = 3;
    const revived = decodeGridState(structuredClone(encodeGridState(state)), state.template);
    expect(revived.template).toBe(state.template);
    expect(revived).toEqual(state);
    expect(mapFingerprint(revived)).toBe(mapFingerprint(state));
  });
});
