/**
 * Pre-command validation is pure: resolving and judging a command writes to neither the command
 * nor the map, and since the registry resolves before any rule runs, the order rules are
 * registered in decides only the order of a refusal's errors.
 */
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, RuleRegistry } from '../../rules/index';
import { traitPlacementRule } from '../../rules/placement';
import { zoneRestrictionRule } from '../../rules/zone-restriction';
import { placementOverlapRule } from '../../rules/placement-overlap';
import { TerrainType, type Command, type GridState, type PlaceObjectCommand } from '../../core/model/types';
import { CellZone } from '../../core/game/zones';
import { eraseTerrainCommand, paintTerrainCommand, placeObjectCommand, removeObjectCommand, trimTerrainCommand } from '../../core/model/command-build';
import { makeState, setTerrain, setZone } from '../_support/map-state';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** A 10x10 layer-1 plateau over (5..14, 5..14), and a three-wide channel two rows deep at
 *  (17..19, 5..6) between layer-1 banks. */
function world(): GridState {
  const state = makeState(24, 24);
  for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  for (const y of [5, 6]) {
    setTerrain(state, 16, y, TerrainType.Mountain, 1);
    for (let x = 17; x <= 19; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    setTerrain(state, 20, y, TerrainType.Mountain, 1);
  }
  return state;
}

const place = (catalogId: string, x: number, y: number): PlaceObjectCommand =>
  placeObjectCommand({ id: `p-${catalogId}-${x}-${y}`, catalogId, position: { x, y }, rotation: 0, elevation: 0 });

function commands(): Command[] {
  const house = { id: 'house', catalogId: 'building-myhouse', position: { x: 16, y: 16 }, rotation: 0 as const, elevation: 0 };
  return [
    place('bridge-plank', 18, 5),
    place('ramp-park-steps', 8, 5),
    place('building-myhouse', 16, 16),
    paintTerrainCommand([{ x: 2, y: 2 }], TerrainType.Mountain, 1),
    paintTerrainCommand([{ x: 6, y: 6 }], TerrainType.Mountain, 0),
    eraseTerrainCommand([{ x: 7, y: 7 }]),
    removeObjectCommand(house),
    trimTerrainCommand(6, 6, ['fan', 'square', 'square', 'square']),
  ];
}

describe('pre-command validation is pure', () => {
  it.each(commands().map((cmd) => [cmd.type, cmd] as const))('resolves and judges a %s without writing to it or the map', (_type, cmd) => {
    const state = world();
    const registry = createDefaultRegistry();
    const frozen = deepFreeze(structuredClone(cmd));
    const cells = structuredClone(state.cells);
    expect(() => registry.validatePreCommand(frozen, state)).not.toThrow();
    const landed = registry.resolve(frozen, state);
    expect(frozen).toEqual(cmd);
    expect(state.cells).toEqual(cells);
    expect(registry.resolve(landed, state), 'a resolved command resolves to itself').toBe(landed);
  });

  it('snaps a bridge and a ramp onto a copy, which the rules accept', () => {
    const state = world();
    const registry = createDefaultRegistry();
    for (const cmd of [place('bridge-plank', 18, 5), place('ramp-park-steps', 8, 5)]) {
      const landed = registry.resolve(cmd, state);
      expect(landed.object.position).not.toEqual(cmd.object.position);
      expect(registry.validatePreCommand(landed, state)).toEqual([]);
    }
  });
});

describe('rule order', () => {
  it('judges a snapped footprint with zone and overlap registered before the trait that snaps it', () => {
    const state = world();
    // A ramp pressed on the plateau's north edge snaps up onto the ground above it, here beach.
    for (let x = 0; x < 24; x++) setZone(state, x, 3, CellZone.Beach);
    const snappingFirst = new RuleRegistry();
    const snappingLast = new RuleRegistry();
    for (const rule of [traitPlacementRule, zoneRestrictionRule, placementOverlapRule]) snappingFirst.register(rule);
    for (const rule of [zoneRestrictionRule, placementOverlapRule, traitPlacementRule]) snappingLast.register(rule);
    const ramp = place('ramp-park-steps', 8, 5);
    const ids = (registry: RuleRegistry) => registry.validatePreCommand(ramp, state).map((e) => e.ruleId).sort();
    expect(ids(snappingFirst)).toContain('V-ZONE-01');
    expect(ids(snappingLast)).toEqual(ids(snappingFirst));
  });
});
