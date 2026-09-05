import { describe, expect, it } from 'vitest';
import {
  annotationsInRect, generateAnnotationId, nextZoneNumber, routeSamples, textApproxWidthCells,
  zoneCentroid, zoneLoops,
  type MapAnnotation, type TextNote,
} from '../../core/model/annotations';

const cells = (...pairs: Array<[number, number]>) => pairs.map(([x, y]) => ({ x, y }));

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
      { kind: 'zone', id: 'a', cells: cells([0, 0]), color: '#fff', name: '', num: 1 },
      { kind: 'zone', id: 'b', cells: cells([1, 0]), color: '#fff', name: '', num: 4 },
      { kind: 'text', id: 'c', x: 0, y: 0, text: 'x', style: 'label', size: 'm', color: '#fff' },
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

describe('text hit box estimate', () => {
  it('grows with length and size, and a chip pads wider than bare lettering', () => {
    const base: TextNote = { kind: 'text', id: 't', x: 0, y: 0, text: '广场', style: 'label', size: 'm', color: '#fff' };
    const longer = { ...base, text: '中心广场花园' };
    const chip = { ...base, style: 'chip' as const };
    const large = { ...base, size: 'l' as const };
    expect(textApproxWidthCells(longer)).toBeGreaterThan(textApproxWidthCells(base));
    expect(textApproxWidthCells(chip)).toBeGreaterThan(textApproxWidthCells(base));
    expect(textApproxWidthCells(large)).toBeGreaterThan(textApproxWidthCells(base));
  });
});

describe('annotationsInRect', () => {
  const zone: MapAnnotation = { kind: 'zone', id: 'z', cells: cells([4, 4], [5, 4]), color: '#f00', name: '', num: 1, size: 'm' };
  const text: MapAnnotation = { kind: 'text', id: 't', x: 10.5, y: 10.5, text: 'a', style: 'chip', size: 'm', color: '#fff' };
  // A straight route crossing x=14..16 at y=2: both endpoints far outside a band over its middle.
  const route: MapAnnotation = { kind: 'route', id: 'r', points: [{ x: 0, y: 2 }, { x: 30, y: 2 }], color: '#00f', dashed: false };
  const items = [zone, text, route];

  it('a zone joins by any cell, text by its anchor', () => {
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
