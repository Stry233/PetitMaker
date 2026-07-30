import { describe, it, expect } from 'vitest';
import { TerrainType, CellZone } from '../../core/model/types';
import { makeState, setTerrain, setZone } from '../rules/_helpers';
import { regionTokens, mapSummary, selectionContext, REGION_CAP } from '../../agent/serialize';

describe('regionTokens', () => {
  it('renders terrain tokens with a coordinate ruler', () => {
    const state = makeState(10, 10);
    setTerrain(state, 2, 1, TerrainType.Mountain, 3);
    setTerrain(state, 3, 1, TerrainType.Water, 0);
    setZone(state, 0, 0, CellZone.Void);
    const out = regionTokens(state, { x1: 0, y1: 0, x2: 4, y2: 2 });
    const rows = out.split('\n');
    expect(rows.some((r) => r.includes('~....'))).toBe(true); // y=0: void then grass
    expect(rows.some((r) => r.includes('..3A.'))).toBe(true); // y=1: mountain3, water0
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
});

describe('mapSummary / selectionContext', () => {
  it('summarizes dimensions, terrain counts and objects', () => {
    const state = makeState(10, 10);
    setTerrain(state, 2, 2, TerrainType.Mountain, 2);
    const s = mapSummary(state);
    expect(s).toContain('10x10');
    expect(s).toContain('elev 2: 1');
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
