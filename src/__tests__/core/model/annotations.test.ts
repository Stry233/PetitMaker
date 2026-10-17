import { describe, expect, it } from 'vitest';
import { generateAnnotationId, isEmptyNote, isMeasureSpan, mergeZones, movedNote, nextZoneNumber, noteStepCell, withTag, zoneCellsOnGrid, zoneHalfCells, type ChipNote, type MapAnnotation, type ZoneNote } from '../../../core/model/annotations';
import { roundedZoneLoops, annotationsInRect, routeSamples, zoneLabelAnchor } from '../../../core/model/annotation/geometry';
import { chipApproxWidthCells } from '../../../core/model/annotation/text-metrics';
import { isTagId, SELECTABLE_ANNOTATION_TAGS } from '../../../config/annotation-tags';

const cells = (...pairs: Array<[number, number]>) => pairs.map(([x, y]) => ({ x, y }));
/** The traced corner loops: the zone outline unrounded, without the repeated closing point. */
const zoneLoops = (zone: ReadonlyArray<{ x: number; y: number }>) => roundedZoneLoops(zone, 0).map((loop) => loop.slice(0, -1));

describe('annotation model ops', () => {
  const zone = (id: string, c: Array<[number, number]>): MapAnnotation => ({ kind: 'zone', id, cells: cells(...c), color: '#FF8A7A', tag: null, num: 1 });
  const chip: ChipNote = { kind: 'chip', id: 'c', x: 0, y: 0, tag: 'homes', size: 'm', color: '#FF8A7A' };

  it('merges zones into the first named, keeping its identity and deduplicating cells in order', () => {
    const items = [zone('a', [[0, 0], [1, 0]]), chip, zone('b', [[1, 0], [2, 0]])];
    const merged = mergeZones(items, ['a', 'c', 'b'])!;
    expect(merged.head).toBe('a');
    expect(merged.items.map((n) => n.id)).toEqual(['a', 'c']);
    expect(merged.items[0]).toMatchObject({ cells: cells([0, 0], [1, 0], [2, 0]) });
    expect(mergeZones(items, ['a', 'c'])).toBeNull();
  });

  it('a measurement spans cells cornered on the half-cell lattice, on one row or column', () => {
    expect(isMeasureSpan([{ x: 1, y: 2 }, { x: 5, y: 2 }])).toBe(true);
    expect(isMeasureSpan([{ x: 1.5, y: 2 }, { x: 5, y: 2 }])).toBe(true);
    expect(isMeasureSpan([{ x: 1, y: 2 }, { x: 5, y: 3 }])).toBe(false);
    expect(isMeasureSpan([{ x: 1.25, y: 2 }, { x: 5, y: 2 }])).toBe(false);
  });

  it('a chip keeps its tag when a pick clears it, and empty drafts are recognised', () => {
    expect(withTag(chip, null)).toBe(chip);
    expect(withTag(zone('a', [[0, 0]]), null)).toMatchObject({ tag: null });
    expect(isEmptyNote(zone('a', []))).toBe(true);
    expect(isEmptyNote(chip)).toBe(false);
  });
});

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

describe('zone caption anchor', () => {
  it('is the mean of the cells\' drawn centres (zone ink lives on the road grid)', () => {
    expect(zoneLabelAnchor(cells([0, 0], [1, 0]))).toEqual({ x: 1, y: 0.5 });
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

describe('zones on the half grid', () => {
  const whole = (c: Array<[number, number]>): ZoneNote => ({ kind: 'zone', id: 'z', cells: cells(...c), color: '#FF8A7A', tag: null, num: 1 });
  const keys = (c: ReadonlyArray<{ x: number; y: number }>) => c.map((p) => `${p.x},${p.y}`).sort();

  it('splits each whole cell into its four half cells', () => {
    expect(keys(zoneHalfCells(whole([[2, 3]])))).toEqual(keys(cells([4, 6], [5, 6], [4, 7], [5, 7])));
    const half: ZoneNote = { ...whole([[1, 1]]), grid: 'half' };
    expect(zoneHalfCells(half)).toBe(half.cells);
  });

  it('stores half cells on the coarsest grid that holds them', () => {
    expect(zoneCellsOnGrid(zoneHalfCells(whole([[2, 3], [3, 3]])))).toEqual({ cells: cells([2, 3], [3, 3]), grid: 'object' });
    const offset = cells([5, 6], [6, 6], [5, 7], [6, 7]);
    expect(zoneCellsOnGrid(offset)).toEqual({ cells: offset, grid: 'half' });
  });

  it('moves in half-cell steps and returns to its whole-cell form', () => {
    const z = whole([[4, 8], [5, 8]]);
    const there = movedNote(z, 0.4, -0.2) as ZoneNote;
    expect(there.grid).toBe('half');
    expect(keys(there.cells)).toEqual(keys(zoneHalfCells(z).map((c) => ({ x: c.x + 1, y: c.y }))));
    expect(movedNote(there, -0.6, 0)).toEqual(z);
    expect(movedNote(z, 2.2, 1)).toEqual(whole([[6, 9], [7, 9]]));
  });

  it('merges zones on both grids on the half grid', () => {
    const items: MapAnnotation[] = [whole([[0, 0]]), { ...whole([]), id: 'h', cells: cells([2, 0]), grid: 'half' }];
    const merged = mergeZones(items, ['z', 'h'])!;
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({ id: 'z', grid: 'half' });
    expect(keys((merged.items[0] as ZoneNote).cells)).toEqual(keys(cells([0, 0], [1, 0], [0, 1], [1, 1], [2, 0])));
  });

  it('traces, anchors and bands a half-grid zone in map cells', () => {
    const loop = roundedZoneLoops(cells([1, 1], [2, 1]), 0, 'half')[0]!.slice(0, -1);
    expect(loop.map(([x, y]) => `${x},${y}`).sort()).toEqual(['0.5,0.5', '0.5,1', '1.5,0.5', '1.5,1']);
    expect(zoneLabelAnchor(cells([1, 1], [2, 1]), 'half')).toEqual({ x: 1, y: 0.75 });
    const z: MapAnnotation = { ...whole([]), cells: cells([20, 20]), grid: 'half' };
    expect(annotationsInRect({ x: 10, y: 10, w: 1, h: 1 }, [z])).toEqual(['z']);
    expect(annotationsInRect({ x: 20, y: 20, w: 1, h: 1 }, [z])).toEqual([]);
  });

  it('puts a note step on the whole cell centred at the nearest half-cell point', () => {
    expect(noteStepCell({ x: 3.5, y: 3.5 })).toEqual({ x: 3, y: 3 });
    expect(noteStepCell({ x: 3.8, y: 3.1 })).toEqual({ x: 3.5, y: 2.5 });
  });
});
