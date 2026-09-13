import { describe, expect, it } from 'vitest';
import {
  roundedZoneLoops, annotationsInRect, chipApproxWidthCells, generateAnnotationId, nextZoneNumber, routeSamples,
  zoneCentroid, zoneLoops, isTagId, SELECTABLE_ANNOTATION_TAGS,
  type ChipNote, type MapAnnotation,
} from '../../core/model/annotations';

const cells = (...pairs: Array<[number, number]>) => pairs.map(([x, y]) => ({ x, y }));

it('keeps retired tags readable without offering them for new notes', () => {
  for (const id of ['workshop', 'ranch']) {
    expect(isTagId(id)).toBe(true);
    expect(SELECTABLE_ANNOTATION_TAGS.some((tag) => tag.id === id)).toBe(false);
  }
});

describe('annotation ids', () => {
  it('a burst of ids never collides', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) ids.add(generateAnnotationId());
    expect(ids.size).toBe(5000);
  });
});

describe('zone numbering', () => {
  it('the next number is one past the highest assigned, so a deleted zone never re-issues its number', () => {
    const notes: MapAnnotation[] = [
      { kind: 'zone', id: 'a', cells: cells([0, 0]), color: '#fff', tag: 'homes', num: 1 },
      { kind: 'zone', id: 'b', cells: cells([1, 0]), color: '#fff', tag: null, num: 4 },
      { kind: 'chip', id: 'c', x: 0, y: 0, tag: 'plaza', size: 'm', color: '#fff' },
    ];
    expect(nextZoneNumber(notes)).toBe(5);
    expect(nextZoneNumber([])).toBe(1);
  });
});

describe('zoneLoops', () => {
  it('a solid rectangle is one loop of its four corners', () => {
    const loops = zoneLoops(cells([1, 1], [2, 1], [1, 2], [2, 2]));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(4);
    const pts = new Set(loops[0]!.map(([x, y]) => `${x},${y}`));
    expect(pts).toEqual(new Set(['1,1', '3,1', '3,3', '1,3']));
  });

  it('an L keeps its six corners', () => {
    const loops = zoneLoops(cells([0, 0], [1, 0], [0, 1]));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toHaveLength(6);
  });

  it('disjoint clusters come back as separate loops', () => {
    const loops = zoneLoops(cells([0, 0], [5, 5]));
    expect(loops).toHaveLength(2);
  });

  it('a ring yields an outer loop and the hole\'s inner rim', () => {
    const ring = cells(
      [0, 0], [1, 0], [2, 0],
      [0, 1], [2, 1],
      [0, 2], [1, 2], [2, 2],
    );
    const loops = zoneLoops(ring);
    expect(loops).toHaveLength(2);
    const sizes = loops.map((l) => l.length).sort((a, b) => a - b);
    expect(sizes).toEqual([4, 4]);
  });
});

describe('zoneCentroid', () => {
  it('is the mean of the cells\' drawn centres (zone ink lives on the terrain grid)', () => {
    expect(zoneCentroid(cells([0, 0], [1, 0]))).toEqual({ x: 0.5, y: 0 });
  });
});

describe('routeSamples', () => {
  it('passes through the first and last waypoints', () => {
    const pts = [{ x: 1, y: 1 }, { x: 4, y: 2 }, { x: 6, y: 7 }];
    const sm = routeSamples(pts);
    expect(sm[0]).toEqual([1, 1]);
    expect(sm[sm.length - 1]).toEqual([6, 7]);
    expect(sm.length).toBeGreaterThan(pts.length);
  });

  it('fewer than two waypoints sample as themselves', () => {
    expect(routeSamples([{ x: 2, y: 3 }])).toEqual([[2, 3]]);
  });
});

describe('chip hit box estimate', () => {
  it('grows with the drawn label and with the size', () => {
    const base: ChipNote = { kind: 'chip', id: 't', x: 0, y: 0, tag: 'plaza', size: 'm', color: '#fff' };
    const large = { ...base, size: 'l' as const };
    expect(chipApproxWidthCells(base, '中心广场花园')).toBeGreaterThan(chipApproxWidthCells(base, '广场'));
    expect(chipApproxWidthCells(large, '广场')).toBeGreaterThan(chipApproxWidthCells(base, '广场'));
  });
});

describe('annotationsInRect', () => {
  const zone: MapAnnotation = { kind: 'zone', id: 'z', cells: cells([4, 4], [5, 4]), color: '#f00', tag: 'homes', num: 1, size: 'm' };
  const text: MapAnnotation = { kind: 'chip', id: 't', x: 10.5, y: 10.5, tag: 'plaza', size: 'm', color: '#fff' };
  // A straight route crossing x=14..16 at y=2: both endpoints far outside a band over its middle.
  const route: MapAnnotation = { kind: 'route', id: 'r', points: [{ x: 0, y: 2 }, { x: 30, y: 2 }], color: '#00f', dashed: false };
  const items = [zone, text, route];

  it('a zone joins by any cell, a chip by its anchor', () => {
    expect(annotationsInRect({ x: 5, y: 4, w: 1, h: 1 }, items)).toEqual(['z']);
    expect(annotationsInRect({ x: 10, y: 10, w: 1, h: 1 }, items)).toEqual(['t']);
    expect(annotationsInRect({ x: 20, y: 20, w: 3, h: 3 }, items)).toEqual([]);
  });

  it('a route joins by its drawn line, not its endpoints alone', () => {
    expect(annotationsInRect({ x: 14, y: 1, w: 3, h: 3 }, items)).toEqual(['r']);
  });

  it('a rect over everything returns every id once', () => {
    expect(annotationsInRect({ x: 0, y: 0, w: 40, h: 40 }, items)).toEqual(['z', 't', 'r']);
  });
});


describe('painted zone boundaries', () => {
  it('preserves every boundary around diagonal brush contacts', () => {
    const cells = [{ x: 3, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 3, y: 1 }, { x: 2, y: 2 }];
    const loops = roundedZoneLoops(cells);
    expect(loops).toHaveLength(3);
    for (const loop of loops) {
      expect(loop.length).toBeGreaterThan(3);
      expect(loop.every((point) => point.every(Number.isFinite))).toBe(true);
      expect(loop[loop.length - 1]).toEqual(loop[0]);
    }
  });

  it('returns valid contours covering every 4 by 4 brush footprint', () => {
    const failures: number[] = [];
    for (let mask = 1; mask < 65536; mask++) {
      const cells = Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) }))
        .filter((_, i) => (mask & (1 << i)) !== 0);
      const loops = zoneLoops(cells);
      const area = loops.reduce((sum, loop) => sum + loop.reduce((a, [x, y], i) => {
        const next = loop[(i + 1) % loop.length]!;
        return a + (x * next[1] - next[0] * y) / 2;
      }, 0), 0);
      if (area !== cells.length || loops.some((loop) => loop.length < 3)) failures.push(mask);
    }
    expect(failures).toEqual([]);
  });
});
