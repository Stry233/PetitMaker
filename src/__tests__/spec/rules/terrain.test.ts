/** How high mountain may stand and what it must stand on. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { build } from './_rules';
import type { MacroCoord } from '../../../core/model/types';

const M = TerrainType.Mountain;

/** The square of cells within `r` of `c`. */
const around = (c: MacroCoord, r: number): MacroCoord[] => rect({ x: c.x - r, y: c.y - r }, 2 * r + 1, 2 * r + 1);

/** A stepped hill whose single top cell `c` stands at `top` (at most nine): every block on a full
 *  three-by-three base within three levels below it. */
function hill(w: SpecWorld, c: MacroCoord, top: number): void {
  for (let e = 1; e <= top; e++) build(w, [around(c, e <= 3 ? 2 : e <= 6 ? 1 : 0), M, e]);
}

describe('mountain height and support', () => {
  spec('V-MTN-01', 'takes mountain up to nine levels over the ground and refuses a tenth', () => {
    const w = world();
    const c = w.openGround(5, 5);
    const top = { x: c.x + 2, y: c.y + 2 };
    hill(w, top, 9);
    expect(w.terrainAt(top)).toEqual({ type: M, elevation: 9 });
    const before = w.fingerprint();
    expect(w.stroke([top], M, 10).refusedBy).toContain('V-MTN-01');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-MTN-02', 'refuses a block with nothing beneath it and takes the same block on a column', () => {
    const w = world();
    const c = w.openGround(3, 3);
    const before = w.fingerprint();
    expect(w.stroke([c], M, 2).refusedBy).toContain('V-MTN-02');
    expect(w.fingerprint()).toBe(before);
    expect(w.stroke([c], M, 1).ok).toBe(true);
    expect(w.stroke([c], M, 2).ok).toBe(true);
    expect(w.terrainAt(c)).toEqual({ type: M, elevation: 2 });
  });

  spec('V-MTN-03', 'lets a lone column stand three levels up and refuses a fourth without a base', () => {
    const w = world();
    const c = w.openGround(5, 5);
    build(w, [[c], M, 1], [[c], M, 2], [[c], M, 3]);
    expect(w.terrainAt(c)).toEqual({ type: M, elevation: 3 });
    const before = w.fingerprint();
    expect(w.stroke([c], M, 4).refusedBy).toContain('V-MTN-03');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-MTN-03', 'takes a fourth level on a full three-by-three base and refuses one with a corner missing', () => {
    const w = world();
    const c = w.openGround(5, 5);
    const center = { x: c.x + 2, y: c.y + 2 };
    const base = around(center, 1);
    build(w, [base.filter((b) => b.x !== center.x - 1 || b.y !== center.y - 1), M, 1], [[center], M, 2], [[center], M, 3]);
    const before = w.fingerprint();
    expect(w.stroke([center], M, 4).refusedBy).toContain('V-MTN-03');
    expect(w.fingerprint()).toBe(before);
    build(w, [[{ x: center.x - 1, y: center.y - 1 }], M, 1]);
    expect(w.stroke([center], M, 4).ok).toBe(true);
  });

  spec('V-MTN-03', 'counts a base only within three levels below the block', () => {
    const w = world();
    const c = w.openGround(5, 5);
    const center = { x: c.x + 2, y: c.y + 2 };
    build(w, [around(center, 1), M, 1], [[center], M, 2], [[center], M, 3], [[center], M, 4]);
    const before = w.fingerprint();
    expect(w.stroke([center], M, 5).refusedBy).toContain('V-MTN-03');
    expect(w.fingerprint()).toBe(before);
    build(w, [around(center, 1).filter((b) => b.x !== center.x || b.y !== center.y), M, 2]);
    expect(w.stroke([center], M, 5).ok).toBe(true);
  });
});
