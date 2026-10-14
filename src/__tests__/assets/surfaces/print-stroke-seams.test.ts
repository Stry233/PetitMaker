import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodePng, type RasterImage } from '../../../io/share/raster/png-raster';
import { getAllItems } from '../../../state/catalog';

/** The surface prints' artwork, which a connected stroke tile reads its exits from. */
const SURFACES = 'src/assets/surfaces';

function edge(image: RasterImage, side: number, turn: number): number[] {
  const n = image.width;
  return Array.from({ length: n }, (_, i) => {
    let [x, y]: [number, number] = side === 0 ? [i, 0] : side === 1 ? [n - 1, i] : side === 2 ? [i, n - 1] : [0, i];
    for (let k = 0; k < turn; k++) [x, y] = [y, n - 1 - x];
    return image.data[(y! * n + x!) * 4 + 3]!;
  });
}

describe('connected print artwork', () => {
  it('shares the same centered edge profile for every stroke and rotation', async () => {
    let reference: number[] | undefined;
    for (const item of getAllItems().filter(item => item.strokeConnections)) {
      expect(item.surfacePrint?.kind).toBe('image');
      if (item.surfacePrint?.kind !== 'image') continue;
      const image = await decodePng(new Uint8Array(readFileSync(`${SURFACES}/${item.surfacePrint.image}.png`)));
      expect(image.width).toBe(image.height);
      let darkest = 255;
      for (let i = 0; i < image.data.length; i += 4) if (image.data[i + 3]! > 128) {
        darkest = Math.min(darkest, image.data[i]!, image.data[i + 1]!, image.data[i + 2]!);
      }
      expect(darkest).toBeGreaterThan(150);
      for (let turn = 0; turn < 4; turn++) for (let side = 0; side < 4; side++) {
        const profile = edge(image, side, turn);
        // After `turn` clockwise quarter turns, side `side` shows the exit drawn on side `side - turn`.
        if (item.strokeConnections! & (1 << ((side - turn + 4) % 4))) {
          reference ??= profile;
          expect(profile, `${item.id} turn ${turn} side ${side}`).toEqual(reference);
          const mass = profile.reduce((a, b) => a + b, 0);
          expect(mass).toBeGreaterThan(0);
          expect(profile.reduce((sum, a, i) => sum + a * i, 0) / mass).toBeCloseTo((image.width - 1) / 2, 5);
        } else expect(Math.max(...profile)).toBe(0);
      }
    }
  });
});
