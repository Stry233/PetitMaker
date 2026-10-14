/**
 * The load repair: what a landmark stands over comes off, the template's ground under it comes back,
 * and whatever that leaves breaking a post-stroke rule gives way around the template's ground.
 */
import { describe, it, expect } from 'vitest';
import { clearUnderLandmarks } from '../../../../tools/generation/transfer';
import { createDefaultRegistry } from '../../../../rules';
import { createGridState, templateTerrainAt } from '../../../../core/model/template';
import { templateAnchor } from '../../../../core/model/landmarks';
import { footprintTerrain } from '../../../../core/grid/footprint';
import { isBuildableZone } from '../../../../core/game/zones';
import { markLegacyUnknown } from '../../../../core/provenance/serialize';
import { getMapTemplate } from '../../../../config/maps';
import { TerrainType, type GridState } from '../../../../core/model/types';

function hexia(): GridState {
  return createGridState(getMapTemplate('hexia'));
}

/** The cells the anchor landmark rests on. */
function underAnchor(state: GridState): { x: number; y: number }[] {
  const a = templateAnchor(state.template)!;
  const r = footprintTerrain({ x: a.x, y: a.y, w: a.width, h: a.height });
  const out: { x: number; y: number }[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

/** A buildable cell with no terrain on it or beside it, far from the landmarks. */
function openCell(state: GridState): { x: number; y: number } {
  const anchor = templateAnchor(state.template)!;
  for (let y = 2; y < state.template.height - 2; y++) {
    for (let x = 2; x < state.template.width - 2; x++) {
      if (Math.abs(x - anchor.x) < 30 && Math.abs(y - anchor.y) < 30) continue;
      const around = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => state.cells[y + dy!]![x + dx!]!);
      if (around.every((c) => isBuildableZone(c.zone) && !c.terrain)) return { x, y };
    }
  }
  throw new Error('no open cell');
}

describe('clearUnderLandmarks', () => {
  it('leaves a map the rules built as it is', () => {
    const state = hexia();
    expect(clearUnderLandmarks(state)).toEqual({ objects: 0, cells: 0, restored: 0 });
  });

  it('lays back the template ground under a landmark and settles what then breaks a rule elsewhere', () => {
    const state = hexia();
    const under = underAnchor(state).find((c) => templateTerrainAt(state.template, c.x, c.y, state.cells[c.y]![c.x]!.zone))!;
    const laid = state.cells[under.y]![under.x]!.terrain;
    state.cells[under.y]![under.x]!.terrain = null;
    const loose = openCell(state);
    state.cells[loose.y]![loose.x]!.terrain = { type: TerrainType.Water, elevation: 1 };
    expect(createDefaultRegistry().validatePostStroke(state).length).toBeGreaterThan(0);

    const cleared = clearUnderLandmarks(state);
    expect(cleared.restored).toBe(1);
    expect(state.cells[under.y]![under.x]!.terrain).toEqual(laid);
    expect(state.cells[loose.y]![loose.x]!.terrain).toBeNull();
    expect(cleared.cells).toBe(1);
    expect(createDefaultRegistry().validatePostStroke(state)).toEqual([]);
  });

  it('takes off an object a landmark stands over, with its taint', () => {
    const state = hexia();
    const a = templateAnchor(state.template)!;
    state.objects.set('under', { id: 'under', catalogId: 'tree-apple', position: { x: Math.floor(a.x) + 2, y: Math.floor(a.y) + 2 }, rotation: 0, elevation: 1 });
    markLegacyUnknown(state);
    expect(state.provenance!.objectTaint.has('under')).toBe(true);

    expect(clearUnderLandmarks(state)).toMatchObject({ objects: 1 });
    expect(state.objects.has('under')).toBe(false);
    expect(state.provenance!.objectTaint.has('under')).toBe(false);
  });
});
