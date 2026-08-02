/**
 * What the commit flash draws over.
 *
 * The flash lands right after the trim pass, so the map already holds the shape it is announcing:
 * flat squares would advertise a result the stroke did not leave (the finetuned curve's flash was
 * square while the curve itself came out rounded).
 */
import { describe, it, expect } from 'vitest';
import { splitFlashShapes } from '../../canvas/map2d/layers/ghost-geometry';

const SQUARE = ['square', 'square', 'square', 'square'];
const cell = (x: number, y: number, micro = true) => ({ x, y, micro });

describe('splitFlashShapes', () => {
  it('draws a cut cell in the shape it has', () => {
    const { shaped, plain } = splitFlashShapes([cell(1, 1)],
      () => ({ corners: ['fan', 'square', 'square', 'square'] }));
    expect(plain).toEqual([]);
    expect(shaped[0]).toMatchObject({ x: 1, y: 1, patchOnly: false });
    expect(shaped[0]!.corners[0]).toBe('fan');
  });

  it('and a Γ patch, whose quadrant is all there is of it', () => {
    const { shaped } = splitFlashShapes([cell(2, 2)],
      () => ({ corners: ['fan', 'empty', 'empty', 'empty'], patchOnly: true }));
    expect(shaped[0]).toMatchObject({ patchOnly: true });
  });

  it('leaves a square cell to the plain rect it always was', () => {
    const { shaped, plain } = splitFlashShapes([cell(3, 3)], () => ({ corners: [...SQUARE] }));
    expect(shaped).toEqual([]);
    expect(plain).toHaveLength(1);
  });

  it('never asks about an object footprint, which has no corners of its own', () => {
    // Macro grid: the flash is over a placed object, not terrain.
    let asked = 0;
    const { shaped, plain } = splitFlashShapes([cell(4, 4, false)],
      () => { asked++; return { corners: ['fan', 'square', 'square', 'square'] }; });
    expect(asked).toBe(0);
    expect(shaped).toEqual([]);
    expect(plain).toHaveLength(1);
  });

  it('copes with a cell the map no longer holds', () => {
    const { shaped, plain } = splitFlashShapes([cell(5, 5)], () => null);
    expect(shaped).toEqual([]);
    expect(plain).toHaveLength(1);
  });
});
