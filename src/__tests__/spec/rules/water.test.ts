/** What water stands on, what holds it in, and the row below a waterfall. */
import { describe, expect } from 'vitest';
import { spec } from '../../_support/spec';
import { rect, TerrainType, world } from '../_world';
import { build } from './_rules';

const M = TerrainType.Mountain;
const W = TerrainType.Water;

describe('water', () => {
  spec('V-WTR-01', 'refuses water two levels up over bare ground and takes it on a column', () => {
    const w = world();
    const c = w.openGround(3, 3);
    const pool = { x: c.x + 1, y: c.y + 1 };
    const ring = rect(c, 3, 3).filter((r) => r.x !== pool.x || r.y !== pool.y);
    build(w, [ring, M, 1], [ring, M, 2]);
    const before = w.fingerprint();
    expect(w.stroke([pool], W, 2).refusedBy).toContain('V-WTR-01');
    expect(w.fingerprint()).toBe(before);
    build(w, [[pool], M, 1]);
    expect(w.stroke([pool], W, 2).ok).toBe(true);
    expect(w.terrainAt(pool)).toEqual({ type: W, elevation: 2 });
  });

  spec('V-WTR-01', 'rests water one level up on the ground itself', () => {
    const w = world();
    const c = w.openGround(3, 3);
    const pool = { x: c.x + 1, y: c.y + 1 };
    build(w, [rect(c, 3, 3).filter((r) => r.x !== pool.x || r.y !== pool.y), M, 1]);
    expect(w.stroke([pool], W, 1).ok).toBe(true);
  });

  spec('V-WTR-02', 'holds a waterfall between two caps at its level and refuses one between taller caps', () => {
    const level = world();
    const a = level.openGround(3, 1);
    build(level, [[a, { x: a.x + 2, y: a.y }], M, 1]);
    expect(level.stroke([{ x: a.x + 1, y: a.y }], W, 1).ok).toBe(true);

    const taller = world();
    build(taller, [[a, { x: a.x + 2, y: a.y }], M, 1], [[a, { x: a.x + 2, y: a.y }], M, 2]);
    const before = taller.fingerprint();
    expect(taller.stroke([{ x: a.x + 1, y: a.y }], W, 1).refusedBy).toContain('V-WTR-02');
    expect(taller.fingerprint()).toBe(before);
  });

  spec('V-WTR-02', 'refuses water with an open side', () => {
    const w = world();
    const a = w.openGround(3, 1);
    build(w, [[a], M, 1]);
    const before = w.fingerprint();
    expect(w.stroke([{ x: a.x + 1, y: a.y }], W, 1).refusedBy).toContain('V-WTR-02');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-WTR-02', 'refuses stacking a block on a waterfall cap', () => {
    const w = world();
    const a = w.openGround(3, 1);
    build(w, [[a, { x: a.x + 2, y: a.y }], M, 1], [[{ x: a.x + 1, y: a.y }], W, 1]);
    const before = w.fingerprint();
    expect(w.stroke([a], M, 2).refusedBy).toContain('V-WTR-02');
    expect(w.fingerprint()).toBe(before);
  });

  spec('V-WTR-03', 'refuses a step in the row below a waterfall and takes one just outside its width', () => {
    const w = world();
    const a = w.openGround(5, 2);
    const fall = { x: a.x + 1, y: a.y };
    build(w, [[a, { x: a.x + 2, y: a.y }], M, 1], [[fall], W, 1]);
    const before = w.fingerprint();
    expect(w.stroke([{ x: a.x, y: a.y + 1 }], M, 1).refusedBy).toContain('V-WTR-03');
    expect(w.fingerprint()).toBe(before);
    expect(w.stroke([{ x: a.x - 1, y: a.y + 1 }, { x: a.x + 3, y: a.y + 1 }], M, 1).ok).toBe(true);
  });

  spec('V-WTR-03', 'takes a row below a waterfall that mixes mountain and water at one level', () => {
    const w = world();
    const a = w.openGround(3, 3);
    const upper = [a, { x: a.x + 1, y: a.y }, { x: a.x + 2, y: a.y }];
    const lowerCaps = [{ x: a.x, y: a.y + 1 }, { x: a.x + 2, y: a.y + 1 }];
    build(w, [[...upper, ...lowerCaps], M, 1], [[a, { x: a.x + 2, y: a.y }], M, 2], [[{ x: a.x + 1, y: a.y + 1 }], W, 1]);
    expect(w.stroke([{ x: a.x + 1, y: a.y }], W, 2).ok).toBe(true);
    expect(w.terrainAt({ x: a.x + 1, y: a.y })).toEqual({ type: W, elevation: 2 });
  });
});
