/** Paving stones keep a mortar joint of uniform width: every edge of a stone moves inward by the same distance. */
import { describe, expect, it } from 'vitest';
import { insetStone, stoneInset } from '../../canvas/road-paving-texture';
import { getCatalogItem } from '../../state/catalog';

type Point = readonly [number, number];

function distanceToLine(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.hypot(dx, dy);
}

function expectUniformInset(stone: readonly Point[], distance: number): void {
  const inset = insetStone(stone, distance);
  expect(inset).toHaveLength(stone.length);
  for (let i = 0; i < stone.length; i++) {
    const a = stone[i]!, b = stone[(i + 1) % stone.length]!;
    for (const p of [inset[i]!, inset[(i + 1) % inset.length]!]) expect(distanceToLine(p, a, b)).toBeCloseTo(distance, 9);
  }
}

describe('paving stones', () => {
  it('inset every masonry edge by the same distance', () => {
    const pattern = getCatalogItem('path-wavy-terracotta')!.roadMaterial!.layers.map((l) => l.pattern)
      .find((p) => typeof p === 'object' && p.kind === 'masonry');
    if (typeof pattern !== 'object' || pattern.kind !== 'masonry') throw new Error('Expected authored masonry');
    for (const { points } of pattern.stones) expectUniformInset(points, stoneInset(pattern.joint));
  });

  it('inset the curved and straight edges of a fan segment alike', () => {
    const arc = (radius: number, from: number, to: number): Point[] => Array.from({ length: 5 }, (_, i) => {
      const angle = from + (to - from) * (i / 4);
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    });
    expectUniformInset([...arc(0.5, 0, Math.PI / 3), ...arc(0.3, Math.PI / 3, 0)], 0.01);
    const fans = getCatalogItem('path-fan-shaped-brick')!.roadMaterial!.edge.pattern;
    if (typeof fans !== 'object' || fans.kind !== 'fans') throw new Error('Expected authored fans');
    let inner = 0;
    for (const ring of fans.rings) {
      const step = Math.PI / ring.segments;
      const segment = [...arc(ring.radius, 0, step), ...arc(inner, step, 0)];
      expect(insetStone(segment, stoneInset(fans.joint)).length, `ring of radius ${ring.radius}`).toBeGreaterThan(2);
      inner = ring.radius;
    }
  });

  it('drop a stone the inset would turn inside out', () => {
    expect(insetStone([[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]], 0.02)).toEqual([]);
  });
});
