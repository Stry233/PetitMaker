import { describe, it, expect } from 'vitest';
import { TerrainType } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { makeObject, makeState, setTerrain, setZone } from '../../_support/map-state';
import { regionTokens, mapSummary, selectionContext, REGION_CAP } from '../../../agent/tools/serialize';

describe('regionTokens', () => {
  it('renders terrain tokens with a coordinate ruler', () => {
    const state = makeState(10, 10);
    // A cell rests on the ground from its own index to the next, so cell (2,1) rests on this mountain
    // and cell (5,1) on this water; the cells touching either rest on it only in part.
    for (const [x, y] of [[2, 1], [3, 1], [2, 2], [3, 2]] as const) setTerrain(state, x, y, TerrainType.Mountain, 3);
    for (const [x, y] of [[5, 1], [6, 1], [5, 2], [6, 2]] as const) setTerrain(state, x, y, TerrainType.Water, 0);
    setZone(state, 0, 0, CellZone.Void);
    const out = regionTokens(state, { x1: 0, y1: 0, x2: 7, y2: 2 });
    const rows = out.split('\n');
    expect(rows.some((r) => r.includes('~^^^===.'))).toBe(true); // y=0: void, the mountain's step, the water's bank, grass
    expect(rows.some((r) => r.includes('.^3^=A=.'))).toBe(true); // y=1: mountain 3 and water 0 between their edges
    expect(out).toContain('Legend');
  });

  it('clamps to map bounds and normalizes inverted rects', () => {
    const state = makeState(10, 10);
    const out = regionTokens(state, { x1: 8, y1: 8, x2: 200, y2: 200 });
    expect(out).toContain('   9 ..'); // last row y=9, two cells (x=8,9)
  });

  it('rejects regions over the cap with guidance', () => {
    const state = makeState(100, 100);
    const out = regionTokens(state, { x1: 0, y1: 0, x2: 60, y2: 60 });
    expect(out).toContain(`${REGION_CAP}`);
    expect(out).toContain('too large');
  });

  it('marks a solid object footprint o on the cells it stands on', () => {
    const state = makeState(10, 10);
    state.objects.set('t', makeObject('tree-apple', 5, 5));
    const out = regionTokens(state, { x1: 4, y1: 4, x2: 7, y2: 7 });
    const rows = out.split('\n');
    expect(rows.some((r) => r.startsWith('   5 ') && r.includes('.o..'))).toBe(true);
    expect(rows.some((r) => r.startsWith('   6 ') && r.includes('....'))).toBe(true);
    expect(out).toContain('o object footprint');
  });

  it('marks a locked object P, and a coating not at all', () => {
    const state = makeState(10, 10);
    state.objects.set('p', { ...makeObject('tree-apple', 2, 2), locked: true });
    state.objects.set('r', makeObject('path-blue-board', 7, 7));
    const out = regionTokens(state, { x1: 0, y1: 0, x2: 9, y2: 9 });
    const rows = out.split('\n');
    expect(rows.some((r) => r.startsWith('   2 ') && r.includes('..P.'))).toBe(true);
    // The road follows a surface change rather than blocking it, so its cell keeps the ground glyph.
    expect(rows.some((r) => r.startsWith('   7 ') && !r.includes('o'))).toBe(true);
  });
});

describe('mapSummary / selectionContext', () => {
  it('summarizes dimensions, terrain counts and objects', () => {
    const state = makeState(10, 10);
    setTerrain(state, 2, 2, TerrainType.Mountain, 2);
    const s = mapSummary(state);
    expect(s).toContain('10x10');
    expect(s).toContain('elev 2: 1');
  });

  it('names only regions near the limit, by their UI names', () => {
    const state = makeState(48, 32);
    for (let i = 0; i < 85; i++) {
      const o = { ...makeObject('flower-protea', 16 + (i % 16), 16 + Math.floor(i / 16)), id: `full-${i}` };
      state.objects.set(o.id, o);
    }
    state.objects.set('light', { ...makeObject('flower-protea', 2, 2), id: 'light' });
    const s = mapSummary(state);
    expect(s).toContain('B2 load=8500 remaining=1500');
    expect(s).not.toContain('A1 load');
    expect(s).toContain('Occupied regions below that share: 1.');
    expect(s).not.toMatch(/\(\d+,\d+\): load/);
  });

  it('describes the selection bbox', () => {
    const ctx = selectionContext([{ x: 2, y: 3 }, { x: 4, y: 5 }]);
    expect(ctx).toContain('(2,3)');
    expect(ctx).toContain('(4,5)');
    expect(ctx).toContain('2 cells');
  });

  it('says none when there is no selection', () => {
    expect(selectionContext([])).toContain('none');
  });
});
