/** Where things may stand: grass for terrain and most objects. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { findCell, groundAt, PlanetWorld } from './_rules';
import { GRASS_ZONE, OFF_MAP_ZONE, SAND_ZONE } from '../../../core/game/zones';

const grass = (w: SpecWorld, x: number, y: number): boolean => groundAt(w, x, y) === GRASS_ZONE && !w.terrainAt({ x, y });

describe('ground zones', () => {
  spec('V-ZONE-01', 'takes a tree on open grass and refuses one on the sea', () => {
    const w = world();
    const at = w.openGround(3, 3);
    expect(w.place('tree-apple', at.x, at.y).ok).toBe(true);
    const sea = { x: 1, y: 1 };
    const before = w.fingerprint();
    expect(w.place('tree-apple', sea.x, sea.y).refusedBy).toContain('V-ZONE-01');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-ZONE-01', 'takes a house wholly on sand, refuses a tree there and the house one cell onto the shore rim', () => {
    const w = world();
    // A 5-by-5 sand patch with sand before its door and the shore rim just past its right side.
    const sand = (x: number, y: number) => groundAt(w, x, y) === SAND_ZONE;
    const at = findCell(w, (x, y) => y >= 2
      && rect({ x, y }, 5, 8).every((c) => sand(c.x, c.y))
      && !sand(x + 5, y) && groundAt(w, x + 5, y) !== null);
    const before = w.fingerprint();
    expect(w.place('tree-apple', at.x, at.y).refusedBy).toContain('V-ZONE-01');
    expect(w.place('building-bamboo-cabin', at.x + 1, at.y).refusedBy).toContain('V-ZONE-01');
    expect(w.fingerprint()).toBe(before);
    expect(w.place('building-bamboo-cabin', at.x, at.y).ok).toBe(true);
  });

  spec('V-ZONE-01', 'refuses terrain on a grass cell whose upper neighbour is off grass and takes it one row down', () => {
    const w = world();
    const at = findCell(w, (x, y) => groundAt(w, x, y - 1) !== GRASS_ZONE
      && rect({ x: x - 1, y }, 2, 2).every((c) => grass(w, c.x, c.y)));
    const before = w.fingerprint();
    expect(w.stroke([at], TerrainType.Mountain, 1).refusedBy).toContain('V-ZONE-01');
    expect(w.fingerprint()).toBe(before);
    expect(w.stroke([{ x: at.x, y: at.y + 1 }], TerrainType.Mountain, 1).ok).toBe(true);
  });

  spec('V-ZONE-01', 'refuses terrain on sand', () => {
    const w = world();
    const at = findCell(w, (x, y) => rect({ x: x - 1, y: y - 1 }, 2, 2).every((c) => groundAt(w, c.x, c.y) === SAND_ZONE));
    const before = w.fingerprint();
    expect(w.stroke([at], TerrainType.Mountain, 1).refusedBy).toContain('V-ZONE-01');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-ZONE-01', 'keeps the planet editor from turning ground to sea under a block that overhangs it', () => {
    const p = new PlanetWorld();
    const at = world().openGround(3, 3);
    const block = { x: at.x + 2, y: at.y + 2 };
    expect(p.stroke([block], TerrainType.Mountain, 1).ok).toBe(true);
    const before = p.fingerprint();
    expect(p.ground([{ x: block.x - 1, y: block.y - 1 }], OFF_MAP_ZONE).refusedBy).toContain('V-ZONE-01');
    expect(p.ground([{ x: block.x, y: block.y - 1 }], SAND_ZONE).refusedBy).toContain('V-ZONE-01');
    expect(p.fingerprint()).toBe(before);
    expect(p.ground([{ x: block.x - 2, y: block.y - 1 }], OFF_MAP_ZONE).ok).toBe(true);
  });
});
