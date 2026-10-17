/**
 * The load repair: what a landmark stands over is taken off, the template's ground under it comes back,
 * and whatever that leaves breaking a post-stroke rule gives way around the template's ground.
 */
import { describe, it, expect } from 'vitest';
import { clearUnderLandmarks } from '../../state/landmark-clearance';
import { createDefaultRegistry } from '../../rules';
import { createGridState, templateTerrainAt } from '../../core/model/template';
import { templateAnchor } from '../../core/model/landmarks';
import { footprintTerrain } from '../../core/grid/footprint';
import { isBuildableZone } from '../../core/game/zones';
import { markLegacyUnknown } from '../../core/provenance/serialize';
import { getMapTemplate } from '../../config/maps';
import { isLegalMap } from '../../state/relocation-plan';
import { holdsTemplateTerrain } from '../../core/model/template';
import { ELEVATION_MAX, TERRAIN_GRID } from '../../core/game/profile';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { TerrainType, type GridState } from '../../core/model/types';

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
    expect(clearUnderLandmarks(state, createDefaultRegistry())).toEqual({ objects: 0, cells: 0, restored: 0 });
  });

  it('lays back the template ground under a landmark and settles what then breaks a rule elsewhere', () => {
    const state = hexia();
    const under = underAnchor(state).find((c) => templateTerrainAt(state.template, c.x, c.y, state.cells[c.y]![c.x]!.zone))!;
    const laid = state.cells[under.y]![under.x]!.terrain;
    state.cells[under.y]![under.x]!.terrain = null;
    const loose = openCell(state);
    state.cells[loose.y]![loose.x]!.terrain = { type: TerrainType.Water, elevation: 1 };
    expect(createDefaultRegistry().validatePostStroke(state).length).toBeGreaterThan(0);

    const cleared = clearUnderLandmarks(state, createDefaultRegistry());
    expect(cleared.restored).toBe(1);
    expect(state.cells[under.y]![under.x]!.terrain).toEqual(laid);
    expect(state.cells[loose.y]![loose.x]!.terrain).toBeNull();
    expect(cleared.cells).toBe(1);
    expect(createDefaultRegistry().validatePostStroke(state)).toEqual([]);
  });

  it('takes off an object a landmark stands over, keeping its taint for its return', () => {
    const state = hexia();
    const a = templateAnchor(state.template)!;
    state.objects.set('under', { id: 'under', catalogId: 'tree-apple', position: { x: Math.floor(a.x) + 2, y: Math.floor(a.y) + 2 }, rotation: 0, elevation: 1 });
    markLegacyUnknown(state);
    expect(state.provenance!.objectTaint.has('under')).toBe(true);

    expect(clearUnderLandmarks(state, createDefaultRegistry())).toMatchObject({ objects: 1 });
    expect(state.objects.has('under')).toBe(false);
    expect(state.provenance!.objectTaint.has('under')).toBe(true);
  });

  it('holds a map with nothing under its landmarks to the same rules: refused terrain goes back to the template\'s and a refused object comes off', () => {
    const state = hexia();
    const sea = { x: 1, y: 1 };
    expect(isBuildableZone(state.cells[sea.y]![sea.x]!.zone)).toBe(false);
    state.cells[sea.y]![sea.x]!.terrain = { type: TerrainType.Mountain, elevation: 2 };
    const peak = openCell(state);
    state.cells[peak.y]![peak.x]!.terrain = { type: TerrainType.Mountain, elevation: ELEVATION_MAX + 2 };
    state.objects.set('afloat', { id: 'afloat', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 });

    const cleared = clearUnderLandmarks(state, createDefaultRegistry());
    const report = cleared.report!;
    expect(report.landmarks).toEqual([]);
    expect(state.cells[sea.y]![sea.x]!.terrain).toBeNull();
    expect(holdsTemplateTerrain(state.template, peak.x, peak.y, state.cells[peak.y]![peak.x]!)).toBe(true);
    expect(report.terrain.filter((t) => t.before !== null).map(({ x, y }) => ({ x, y })))
      .toEqual(expect.arrayContaining([sea, peak]));
    expect(report.objects).toEqual([expect.objectContaining({ issue: 'invalid', rule: 'V-ZONE-01', object: expect.objectContaining({ id: 'afloat' }) })]);
    expect(isLegalMap(state, createDefaultRegistry())).toBe(true);
  });

  it('sets every cell back to its template\'s terrain and plans every object afresh when the rules still fail after the settle', () => {
    const state = hexia();
    const loose = openCell(state);
    state.cells[loose.y]![loose.x]!.terrain = { type: TerrainType.Mountain, elevation: 1 };
    const a = templateAnchor(state.template)!;
    state.objects.set('tree', { id: 'tree', catalogId: 'tree-apple', position: { x: loose.x + 3, y: loose.y }, rotation: 0, elevation: 0 });
    // A rule neither the settle nor taking refused objects answers: it flags a cell of the landmark's
    // own ground while any unlocked object stands anywhere.
    const base = createDefaultRegistry();
    const flag = { ruleId: 'V-TEST', message: 'error.test', grid: TERRAIN_GRID, cells: [{ x: Math.floor(a.x) + 2, y: Math.floor(a.y) + 2 }] };
    const strict: RuleDispatcher = {
      resolve: (cmd, s) => base.resolve(cmd, s),
      validatePreCommand: (cmd, s, scope) => base.validatePreCommand(cmd, s, scope),
      getRules: () => base.getRules(),
      validatePostStroke: (s, opts) => [
        ...base.validatePostStroke(s, opts),
        ...([...s.objects.values()].some((o) => !o.locked) ? [flag as ReturnType<RuleDispatcher['validatePostStroke']>[number]] : []),
      ],
    };
    const cleared = clearUnderLandmarks(state, strict);
    expect(cleared.reset).toBe(true);
    expect(state.cells.every((row, y) => row.every((cell, x) => holdsTemplateTerrain(state.template, x, y, cell)))).toBe(true);
    expect(cleared.report!.objects.map((o) => o.object.id)).toEqual(['tree']);
    expect(cleared.report!.plan.moves).toEqual([{ id: 'tree', group: 0, proposal: { kind: 'no-place' } }]);
    expect(isLegalMap(state, strict)).toBe(true);
  });
});
