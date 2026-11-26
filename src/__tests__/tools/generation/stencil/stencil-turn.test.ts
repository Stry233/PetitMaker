/** A stencil turned a quarter turn at a time: every per-cell layer moves with its cell. */
import { describe, it, expect } from 'vitest';
import { turnStencil } from '../../../../tools/generation/stencil/stencil-turn';
import type { Stencil } from '../../../../tools/generation/recipe';

/** A 2-wide, 3-tall stencil whose top-left cell alone is covered, its TL quadrant alone filled and
 *  its line leaving north; every other per-cell layer carries the cell's own index so a misplaced
 *  cell shows. */
function sample(): Stencil {
  const w = 2, h = 3, n = w * h;
  const quad = new Uint8Array(n * 4);
  quad[0] = 255;
  return {
    width: w, height: h, cellAligned: true, nature: 'flat',
    coverage: Uint8Array.from({ length: n }, (_, i) => (i === 0 ? 255 : 0)),
    color: Uint32Array.from({ length: n }, (_, i) => 0x100000 + i),
    curves: Uint8Array.from({ length: n }, (_, i) => i),
    connections: Uint8Array.from({ length: n }, (_, i) => (i === 0 ? 1 : 0)),
    quad,
  };
}

describe('turnStencil', () => {
  it('returns the stencil itself for no turn', () => {
    const s = sample();
    expect(turnStencil(s, 0)).toBe(s);
  });

  it('comes back to the same stencil after four quarter turns', () => {
    const s = sample();
    let t = s;
    for (let i = 0; i < 4; i++) t = turnStencil(t, 90);
    expect(t).toEqual(s);
  });

  it('turns a quarter turn clockwise: the top-left cell goes top-right, its TL quadrant to TR and its north exit to east', () => {
    const t = turnStencil(sample(), 90);
    expect([t.width, t.height]).toEqual([3, 2]);
    const topRight = 2;
    expect([...t.coverage]).toEqual([0, 0, 255, 0, 0, 0]);
    expect([...t.quad!.slice(topRight * 4, topRight * 4 + 4)]).toEqual([0, 255, 0, 0]);
    expect(t.connections![topRight]).toBe(2);
    expect(t.color[topRight]).toBe(0x100000);
    expect(t.curves![topRight]).toBe(0);
    expect([t.cellAligned, t.nature]).toEqual([true, 'flat']);
  });

  it('turns half a turn as two quarter turns', () => {
    expect(turnStencil(sample(), 180)).toEqual(turnStencil(turnStencil(sample(), 90), 90));
    expect(turnStencil(sample(), 270)).toEqual(turnStencil(turnStencil(sample(), 180), 90));
  });
});
