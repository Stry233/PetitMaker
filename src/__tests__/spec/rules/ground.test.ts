/** The ground itself: fixed on a map, editable in the planet editor except under what stands on it. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { TerrainType, world } from '../_world';
import { PlanetWorld, run } from './_rules';
import { eraseTerrainCommand, paintTerrainCommand } from '../../../core/model/command-build';
import { OFF_MAP_ZONE, SAND_ZONE } from '../../../core/game/zones';
import type { MacroCoord } from '../../../core/model/types';

describe('the ground', () => {
  spec('V-GROUND-LOCK', 'refuses turning land into sea or sand on a map and takes terrain on the same cells', () => {
    const w = world();
    const at = w.openGround(3, 3);
    const before = w.fingerprint();
    expect(run(w, eraseTerrainCommand([at], OFF_MAP_ZONE)).refusedBy).toContain('V-GROUND-LOCK');
    expect(run(w, paintTerrainCommand([at], TerrainType.Mountain, 0, SAND_ZONE)).refusedBy).toContain('V-GROUND-LOCK');
    expect(w.fingerprint()).toBe(before);
    expect(run(w, paintTerrainCommand([at], TerrainType.Mountain, 1)).ok).toBe(true);
  });

  spec('V-GROUND-LOCK', 'lets the planet editor turn the same land into sea', () => {
    const at = world().openGround(3, 3);
    expect(new PlanetWorld().ground([at], OFF_MAP_ZONE).ok).toBe(true);
  });

  spec('V-PLANET-01', 'refuses changing the ground under a placed object and takes the ground beside it', () => {
    const p = new PlanetWorld();
    const at = world().openGround(5, 3);
    expect(p.place('tree-apple', at.x, at.y).ok).toBe(true);
    const before = p.fingerprint();
    expect(p.ground([at], OFF_MAP_ZONE).refusedBy).toContain('V-PLANET-01');
    expect(p.ground([at], SAND_ZONE).refusedBy).toContain('V-PLANET-01');
    expect(p.fingerprint()).toBe(before);
    expect(p.ground([{ x: at.x + 2, y: at.y }], OFF_MAP_ZONE).ok).toBe(true);
  });

  spec('V-PLANET-01', 'refuses changing the ground under a landmark', () => {
    const p = new PlanetWorld();
    const landmark = [...p.state.objects.values()].find((o) => o.locked)!;
    const inside: MacroCoord = { x: Math.ceil(landmark.position.x) + 1, y: Math.ceil(landmark.position.y) + 1 };
    const before = p.fingerprint();
    expect(p.ground([inside], OFF_MAP_ZONE).refusedBy).toContain('V-PLANET-01');
    expect(p.fingerprint()).toBe(before);
  });
});
