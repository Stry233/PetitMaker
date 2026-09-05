/**
 * Some road surfaces support flowers and crops, and the
 * editor grants that through the road's `plantable` trait — the dirt road today. Flora and a
 * plantable road COEXIST on a cell, in both orders of arrival: placing flora keeps the road it
 * lands on, and painting the road under standing flora keeps the flowers. Everything else keeps
 * the coating discipline: a tree or building still strips or is refused, and a stone road still
 * cannot carry a flower.
 */
import { describe, it, expect } from 'vitest';
import { CellZone, CommandType, type GridState, type PlacedObject } from '../../core/model/types';
import { standsOnCoating } from '../../core/model/traits';
import { getCatalogItem } from '../../state/catalog';
import { placementOverlapRule } from '../../rules/placement-overlap';
import { makeState, makeExecutor, placeCmd } from './_helpers';
import { bumpObjectsVersion } from '../../core/model/grid-model';

function grassMap(): GridState {
  const state = makeState(20, 20);
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) state.cells[y]![x]!.zone = CellZone.Grass;
  return state;
}

const at = (id: string, catalogId: string, x: number, y: number): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation: 0, elevation: 0 });

describe('standsOnCoating', () => {
  it('grants flora on a plantable coating, and nothing else', () => {
    const daisy = getCatalogItem('flower-daisy')!;
    const tree = getCatalogItem('tree-apple')!;
    const dirt = getCatalogItem('path-overgrown-dirt')!;
    const cobblestone = getCatalogItem('path-cobblestone')!;
    expect(standsOnCoating(daisy, dirt)).toBe(true);
    expect(standsOnCoating(daisy, cobblestone)).toBe(false);
    expect(standsOnCoating(tree, dirt)).toBe(false);
    expect(standsOnCoating(undefined, dirt)).toBe(false);
  });
});

describe('a plantable road under standing flora', () => {
  it('may be placed there — the pair coexists in either order', () => {
    const state = grassMap();
    state.objects.set('f', at('f', 'flower-daisy', 4, 4));
    bumpObjectsVersion(state, { added: [state.objects.get('f')!] });
    const cmd = { type: CommandType.PlaceObject, timestamp: 0, object: at('r', 'path-overgrown-dirt', 4, 4), loadValue: 10 } as const;
    expect(placementOverlapRule.validate(cmd as never, state)).toEqual([]);
  });

  it('a coating over a coating is refused outright — repainting strips first', () => {
    const state = grassMap();
    state.objects.set('r1', at('r1', 'path-cobblestone', 4, 4));
    bumpObjectsVersion(state, { added: [state.objects.get('r1')!] });
    const cmd = { type: CommandType.PlaceObject, timestamp: 0, object: at('r2', 'path-overgrown-dirt', 4, 4), loadValue: 10 } as const;
    expect(placementOverlapRule.validate(cmd as never, state).length).toBeGreaterThan(0);
  });

  it('a stone road under flora is still an overlap', () => {
    const state = grassMap();
    state.objects.set('f', at('f', 'flower-daisy', 4, 4));
    bumpObjectsVersion(state, { added: [state.objects.get('f')!] });
    const cmd = { type: CommandType.PlaceObject, timestamp: 0, object: at('r', 'path-cobblestone', 4, 4), loadValue: 10 } as const;
    expect(placementOverlapRule.validate(cmd as never, state).length).toBeGreaterThan(0);
  });
});

describe('flora and the dirt road, end to end', () => {
  it('both stand after the stroke commits', () => {
    const state = grassMap();
    const exec = makeExecutor(state);
    exec.execute(placeCmd(at('r', 'path-overgrown-dirt', 4, 4), 10));
    const start = exec.getUndoStackSize();
    exec.execute(placeCmd(at('f', 'flower-daisy', 4, 4)));
    expect(exec.commitStroke(start)).toEqual([]);
    expect(state.objects.has('r'), 'the road survives the flower').toBe(true);
    expect(state.objects.has('f'), 'the flower survives the commit').toBe(true);
  });
});
