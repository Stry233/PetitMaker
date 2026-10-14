import { describe, expect, it } from 'vitest';
import { applySurfaceGrain, periodicGrain } from '../../../../view/shared/road/surface-grain';

describe('surface pigment detail', () => {
  it('meets continuously at both repeat seams', () => {
    const noise = periodicGrain(7, 53217);
    for (const t of [0, .17, .53, .89, 1]) {
      expect(noise(0, t)).toBeCloseTo(noise(1, t), 8);
      expect(noise(t, 0)).toBeCloseTo(noise(t, 1), 8);
      expect(noise(-.00001, t)).toBeCloseTo(noise(.00001, t), 5);
    }
  });

  it('changes pigment without filling transparent parts of a print', () => {
    const data = new Uint8ClampedArray([100, 120, 140, 0, 100, 120, 140, 100, 100, 120, 140, 255, 100, 120, 140, 255]);
    const context = { getImageData: () => ({ data }), putImageData: () => {} } as unknown as CanvasRenderingContext2D;
    applySurfaceGrain(context, 2, { grain: .3, clouds: .3 });
    expect([data[3], data[7], data[11], data[15]]).toEqual([0, 100, 255, 255]);
    expect([...data.slice(0, 4)]).toEqual([100, 120, 140, 0]);
    expect([...data.slice(4, 7)]).not.toEqual([100, 120, 140]);
  });
});
