import { describe, expect, it } from 'vitest';
import { resizeMeasurement, cellBounds, dimensionDrawing, dimensionHit, measureDrawing } from '../../core/model/annotation-dimensions';
import { annotationsInRect, type MeasureNote } from '../../core/model/annotations';

const p = (x: number, y: number) => ({ x, y });
describe('inclusive annotation dimensions', () => {
  it('selects the interior of a long measurement without skipping cells between samples', () => {
    const note: MeasureNote = { kind: 'measure', id: 'm', points: [p(1, 4), p(84, 4)], color: '#FFB347' };
    expect(annotationsInRect({ x: 50, y: 4, w: 1, h: 1 }, [note])).toEqual(['m']);
    expect(annotationsInRect({ x: 50, y: 5, w: 1, h: 1 }, [note])).toEqual([]);
  });
  it.each([[[p(0, 4), p(83, 4)], [84]], [[p(83, 4), p(0, 4)], [84]], [[p(5, 2), p(5, 85)], [84]], [[p(4, 4), p(4, 4)], [1]]])('counts both end cells for %j', (points, expected) => {
    expect(measureDrawing(points as [{ x: number; y: number }, { x: number; y: number }], 1).labels.map(label => label.value)).toEqual(expected);
  });
  it.each([[[p(1, 4), p(84, 4)], 'y'], [[p(4, 1), p(4, 84)], 'x']] as const)('flips %j across its span without changing the count', (points, axis) => {
    const normal = measureDrawing(points, 2);
    const flipped = measureDrawing(points, 2, true);
    expect(flipped.labels[0]!.value).toBe(84);
    expect(flipped.labels[0]!.at[axis]).toBeLessThan(points[0][axis]);
    expect(normal.labels[0]!.at[axis]).toBeGreaterThan(points[0][axis]);
    expect(dimensionHit(flipped.labels[0]!.at, flipped, 2)).toBe(true);
    expect(dimensionHit(normal.labels[0]!.at, flipped, 2)).toBe(false);
  });
  it('measures the extent of an irregular region rather than its occupied area', () => {
    const bounds = cellBounds([p(-3, 1), p(4, 1), p(4, 5)]);
    expect(bounds).toEqual({ left: -3.5, right: 4.5, top: 0.5, bottom: 5.5 });
    expect(dimensionDrawing(bounds!, 3).labels.map(label => label.value)).toEqual([8, 5]);
    expect(cellBounds([])).toBeNull();
  });
  it('keeps counts independent from ink scale and makes labels and extension lines selectable', () => {
    for (const ink of [1, 5]) {
      const drawing = measureDrawing([p(2, 2), p(85, 2)], ink);
      expect(drawing.labels[0]?.value).toBe(84);
      expect(dimensionHit(drawing.labels[0]!.at, drawing, ink)).toBe(true);
      expect(dimensionHit(p(1.5, 2), drawing, ink)).toBe(true);
      expect(dimensionHit(p(-20, -20), drawing, ink)).toBe(false);
    }
  });
});

it('resizes either endpoint on the original axis, including crossing the fixed endpoint', () => {
  const vertical = [p(5, 2), p(5, 10)] as const;
  expect(resizeMeasurement(vertical, 0, p(19, 14.3))).toEqual([p(5, 14), p(5, 10)]);
  expect(resizeMeasurement(vertical, 1, p(19, 2))).toEqual([p(5, 2), p(5, 2)]);
  expect(resizeMeasurement(vertical, 1, p(19, 0))).toEqual([p(5, 2), p(5, 0)]);
  expect(resizeMeasurement([p(2, 5), p(10, 5)], 0, p(14.3, 19))).toEqual([p(14, 5), p(10, 5)]);
});
