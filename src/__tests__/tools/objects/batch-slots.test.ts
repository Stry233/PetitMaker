/**
 * A Paint stroke's spots: footprints never overlap and stand at least the spacing's empty cells apart,
 * whatever the items' sizes, an area keeps every footprint inside itself, and the picked items take
 * the spots in turn.
 */
import { describe, expect, it } from 'vitest';
import { BatchSlots, type BatchSlot } from '../../../tools/objects/batch-slots';
import { getCatalogItem } from '../../../state/catalog';
import { rectCells, line4 } from '../../../core/grid/shapes';
import type { CatalogItem } from '../../../core/model/types';

const rose = getCatalogItem('flower-rose')!;
/** A two-by-two stand-in: the rose's facts on a larger footprint. */
const big: CatalogItem = { ...rose, id: 'big', width: 2, height: 2 };

const rectOf = (slot: BatchSlot) => ({ x: slot.anchor.x, y: slot.anchor.y, w: slot.item.width, h: slot.item.height });

/** The empty cells between two footprints along the axis they are apart on, or -1 when they overlap. */
function gap(a: BatchSlot, b: BatchSlot): number {
  const p = rectOf(a), q = rectOf(b);
  const gx = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w));
  const gy = Math.max(q.y - (p.y + p.h), p.y - (q.y + q.h));
  return Math.max(gx, gy);
}

describe('a Paint stroke\'s spots', () => {
  for (const spacing of [0, 1, 3]) {
    it(`keep at least ${spacing} empty cells between any two footprints, mixed sizes included`, () => {
      const cells = rectCells({ x: 0, y: 0 }, { x: 13, y: 9 });
      const slots = new BatchSlots([big, rose], spacing, 0, { kind: 'area', from: { x: 0, y: 0 } }).add(cells);
      expect(slots.length).toBeGreaterThan(2);
      for (let i = 0; i < slots.length; i++) {
        for (let j = i + 1; j < slots.length; j++) expect(gap(slots[i]!, slots[j]!)).toBeGreaterThanOrEqual(spacing);
      }
      for (const slot of slots) {
        const r = rectOf(slot);
        expect(r.x >= 0 && r.y >= 0 && r.x + r.w <= 14 && r.y + r.h <= 10, 'inside the area').toBe(true);
      }
    });
  }

  it('lays a large item by its own footprint plus the spacing', () => {
    const cells = rectCells({ x: 0, y: 0 }, { x: 6, y: 1 });
    const slots = new BatchSlots([big], 1, 0, { kind: 'area', from: { x: 0, y: 0 } }).add(cells);
    expect(slots.map((s) => s.anchor.x)).toEqual([0, 3]);
  });

  it('takes the picked items in turn along a path, and a freehand stroke continues the turn across its sweeps', () => {
    const slots = new BatchSlots([rose, big], 0, 0, { kind: 'path' });
    const first = slots.add(line4(0, 0, 3, 0));
    const second = slots.add(line4(4, 0, 9, 0));
    expect([...first, ...second].map((s) => s.item.id).slice(0, 4)).toEqual(['flower-rose', 'big', 'flower-rose', 'big']);
  });
});
