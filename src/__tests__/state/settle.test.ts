import { describe, it, expect } from 'vitest';
import { backOffAt, type SettleActions } from '../../state/settle';
import { TerrainType, type MacroCoord, type PlacedObject } from '../../core/model/types';
import { makeState, setTerrain } from '../_support/map-state';

function recorder(state: ReturnType<typeof makeState>) {
  const erased: MacroCoord[] = [];
  const removed: string[] = [];
  const act: SettleActions = {
    eraseTerrain: (c) => { erased.push(c); state.cells[c.y]![c.x]!.terrain = null; return true; },
    removeObject: (o) => { removed.push(o.id); return true; },
  };
  return { act, erased, removed };
}

describe('backOffAt', () => {
  it('gives up the flagged cell\'s own terrain first', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 3);
    const { act, erased } = recorder(state);
    expect(backOffAt(state, act, { x: 5, y: 5 }, { standingAt: () => null })).toBe(true);
    expect(erased).toEqual([{ x: 5, y: 5 }]);
  });

  it('then the object standing there, then the taller terrain beside it', () => {
    const state = makeState();
    setTerrain(state, 6, 5, TerrainType.Mountain, 3);
    const obj = { id: 'o1' } as PlacedObject;
    const first = recorder(state);
    backOffAt(state, first.act, { x: 5, y: 5 }, { standingAt: () => obj });
    expect(first.removed).toEqual(['o1']);
    expect(first.erased).toEqual([]);
    const second = recorder(state);
    backOffAt(state, second.act, { x: 5, y: 5 }, { standingAt: () => null });
    expect(second.erased).toEqual([{ x: 6, y: 5 }]);
  });

  it('keeps held terrain and, at a held cell, takes its unheld neighbours instead', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 4, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    const { act, erased } = recorder(state);
    backOffAt(state, act, { x: 5, y: 5 }, { standingAt: () => null, held: new Set(['5,5', '6,5']) });
    expect(erased).toEqual([{ x: 4, y: 5 }]);
  });
});
