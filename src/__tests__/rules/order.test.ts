import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, createPlanetRegistry, RuleRegistry } from '../../rules/index';
import { CommandType, TerrainType, type GridState, type PostStrokeRule } from '../../core/model/types';
import { baseSupportRule } from '../../rules/base-support';
import { waterContainmentRule } from '../../rules/water-containment';
import { waterfallAdjacentUniformityRule } from '../../rules/waterfall-uniformity';
import { objectOnCoatingRule } from '../../rules/object-on-coating';
import { makeExecutor, makeState, paintCmd, setTerrain } from '../_support/map-state';

/** The canonical order: locks first, the snapping trait rule before zone and overlap, post-stroke last. */
const DEFAULT_ORDER = [
  ['V-LOCK-01', 'pre-command'],
  ['V-LOCK-02', 'pre-command'],
  ['V-MTN-01', 'pre-command'],
  ['V-MTN-02', 'pre-command'],
  ['V-WTR-01', 'pre-command'],
  ['V-PLACE-BLOCK', 'pre-command'],
  ['V-PLACE-TRAIT', 'pre-command'],
  ['V-PLACE-DOOR', 'pre-command'],
  ['V-GROUND-LOCK', 'pre-command'],
  ['V-ZONE-01', 'pre-command'],
  ['V-PLACE-OVERLAP', 'pre-command'],
  ['V-PLACE-MAX', 'pre-command'],
  ['V-CHUNK-01', 'pre-command'],
  ['V-MTN-03', 'post-stroke'],
  ['V-WTR-02', 'post-stroke'],
  ['V-WTR-03', 'post-stroke'],
  ['V-PLACE-COATED', 'post-stroke'],
] as const;

const table = (registry: RuleRegistry) => registry.getRules().map((r) => [r.id, r.phase]);

describe('rule registration order', () => {
  it('registers every rule once, in the canonical order and phase', () => {
    expect(table(createDefaultRegistry())).toEqual(DEFAULT_ORDER.map((r) => [...r]));
  });

  it('gives the planet session every rule but the ground lock, with the planet ground rule last', () => {
    const expected: string[][] = DEFAULT_ORDER.filter(([id]) => id !== 'V-GROUND-LOCK').map((r) => [...r]);
    // Post-stroke rules are listed after every pre-command rule whatever their registration order.
    expected.splice(expected.findIndex(([, phase]) => phase === 'post-stroke'), 0, ['V-PLANET-01', 'pre-command']);
    expect(table(createPlanetRegistry())).toEqual(expected);
  });
});

/** A map that breaks every post-stroke rule it can without objects: unsupported layer 4 and open water. */
function brokenTwice(): GridState {
  const state = makeState(20, 20);
  setTerrain(state, 3, 3, TerrainType.Mountain, 4);
  setTerrain(state, 12, 12, TerrainType.Water, 1);
  setTerrain(state, 14, 14, TerrainType.Water, 1);
  return state;
}

describe('firstOnly', () => {
  it('stops at the first violation, in rule order, and the full pass reports them all', () => {
    const registry = createDefaultRegistry();
    const all = registry.validatePostStroke(brokenTwice());
    expect(all.map((e) => e.ruleId)).toEqual(['V-MTN-03', 'V-WTR-02', 'V-WTR-02']);
    const first = registry.validatePostStroke(brokenTwice(), { firstOnly: true });
    expect(first).toEqual([all[0]]);
  });

  it('each post-stroke rule returns at most one error under firstOnly and the first of its full list', () => {
    const rules: PostStrokeRule[] = [baseSupportRule, waterContainmentRule, waterfallAdjacentUniformityRule, objectOnCoatingRule];
    expect(rules.map((r) => r.id)).toEqual(DEFAULT_ORDER.filter(([, phase]) => phase === 'post-stroke').map(([id]) => id));
    for (const rule of rules) {
      const full = rule.validate(brokenTwice());
      const first = rule.validate(brokenTwice(), { firstOnly: true });
      expect(first.length, rule.id).toBeLessThanOrEqual(1);
      expect(first, rule.id).toEqual(full.slice(0, 1));
    }
  });

  it('answers a clean map with no errors either way', () => {
    const registry = createDefaultRegistry();
    expect(registry.validatePostStroke(makeState(), { firstOnly: true })).toEqual([]);
    expect(registry.validatePostStroke(makeState())).toEqual([]);
  });
});

describe('rollback after a post-stroke violation', () => {
  it('a stroke of open water leaves the map exactly as it was before the stroke', () => {
    const cmds = [paintCmd([{ x: 5, y: 5 }], TerrainType.Water, 1)];
    const state = makeState(20, 20);
    const exec = makeExecutor(state);
    const start = exec.beginStroke();
    exec.execute(paintCmd([{ x: 15, y: 15 }], TerrainType.Mountain, 1));
    start.commit();
    const before = JSON.stringify(state.cells);
    const objects = [...state.objects.keys()];
    const strokeStart = exec.beginStroke();
    for (const cmd of cmds) expect(exec.execute(cmd).success).toBe(true);
    expect(strokeStart.commit().length).toBeGreaterThan(0);
    expect(JSON.stringify(state.cells)).toBe(before);
    expect([...state.objects.keys()]).toEqual(objects);
    expect(strokeStart.size).toBe(0);
    expect(exec.canRedo()).toBe(false);
    expect(createDefaultRegistry().validatePostStroke(state)).toEqual([]);
    // The step before the stroke is still the one undo takes back.
    exec.undo();
    expect(state.cells[15]![15]!.terrain).toBeNull();
  });

  it('a tower stroke that outgrows its base reverts to its tallest legal tier', () => {
    const state = makeState(20, 20);
    const exec = makeExecutor(state);
    const whole = exec.beginStroke();
    for (const e of [1, 2, 3, 4, 5]) expect(exec.execute(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, e)).success).toBe(true);
    expect(whole.commit().map((e) => e.ruleId)).toContain('V-MTN-03');
    expect(state.cells[5]![5]!.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 3 });
    expect(exec.historyDepth()).toBe(1);
    exec.undo();
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });

  it('keeps the part of a stroke that is legal on its own and drops only what broke the map', () => {
    const state = makeState(20, 20);
    const exec = makeExecutor(state);
    const whole = exec.beginStroke();
    exec.execute(paintCmd([{ x: 2, y: 2 }], TerrainType.Mountain, 1));
    exec.execute({ type: CommandType.PaintTerrain, cells: [{ x: 9, y: 9 }], terrainType: TerrainType.Water, elevation: 1 });
    expect(whole.commit().map((e) => e.ruleId)).toEqual(['V-WTR-02']);
    expect(state.cells[2]![2]!.terrain).not.toBeNull();
    expect(state.cells[9]![9]!.terrain).toBeNull();
    expect(exec.historyDepth()).toBe(1);
  });
});
