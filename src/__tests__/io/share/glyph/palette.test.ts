import { describe, it, expect } from 'vitest';
import {
  PALETTE16, PALETTE16_V1, PALETTE16_V2, PALETTE8_INDICES, HEADER_LEVELS, Y_LEVELS,
  BASE_CHROMA_OFFSETS, CHROMA_SCALES, paletteForVersion, rgbToYcc, classify, type RGB,
} from '../../../../io/share/glyph/palette';
import { HEADER_VERSION } from '../../../../io/share/glyph/geometry';

const VERSIONS: [number, readonly RGB[]][] = [[1, PALETTE16_V1], [2, PALETTE16_V2]];

/** Squared classifier distance (the exact expression classify() minimizes). */
function dist2(a: RGB, b: RGB): number {
  const [ay, acb, acr] = rgbToYcc(a[0], a[1], a[2]);
  const [by, bcb, bcr] = rgbToYcc(b[0], b[1], b[2]);
  return 2 * (ay - by) ** 2 + (acb - bcb) ** 2 + (acr - bcr) ** 2;
}

/** Closest pair within each luma band (index layout luma*4+chroma), so within a band only chroma
 *  separates the four entries. */
function bandSeparations(pal: readonly RGB[]): number[] {
  return [0, 1, 2, 3].map((band) => {
    let min = Infinity;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      min = Math.min(min, dist2(pal[band * 4 + a]!, pal[band * 4 + b]!));
    }
    return Math.round(min);
  });
}

function minSeparation(entries: readonly RGB[]): number {
  let min = Infinity;
  for (let a = 0; a < entries.length; a++) for (let b = a + 1; b < entries.length; b++) {
    min = Math.min(min, dist2(entries[a]!, entries[b]!));
  }
  return Math.round(min);
}

describe('luma-first palette', () => {
  for (const [version, pal] of VERSIONS) {
    describe(`v${version}`, () => {
      it('has 4 distinct luma bands ≥ 40 Y apart, 4 colors each', () => {
        const ys = pal.map((c) => rgbToYcc(c[0], c[1], c[2])[0]).sort((a, b) => a - b);
        const bands = [ys.slice(0, 4), ys.slice(4, 8), ys.slice(8, 12), ys.slice(12)];
        for (const band of bands) expect(Math.max(...band) - Math.min(...band)).toBeLessThan(14);
        for (let i = 0; i < 3; i++) expect(bands[i + 1]![0]! - bands[i]![3]!).toBeGreaterThan(28);
      });
      it('classify is exact on clean palette colors with high confidence', () => {
        for (let i = 0; i < 16; i++) {
          const r = classify(pal[i]!, pal);
          expect(r.idx).toBe(i);
          expect(r.confidence).toBeGreaterThan(0.5);
        }
      });
      it('8-subset uses all 4 luma bands and beats the full palette on separation', () => {
        expect(new Set(PALETTE8_INDICES.map((i) => i >> 2)).size).toBe(4); // index layout: luma*4+chroma
        // Chroma columns {0,2} sit nearly opposite, so dropping to 8 colors buys margin at every
        // band rather than merely leaving the 16-color spacing alone.
        expect(minSeparation(PALETTE8_INDICES.map((i) => pal[i]!))).toBeGreaterThan(minSeparation(pal) * 2);
      });

      // Re-derivation guard: the tables are baked as literal RGB triplets (see palette.ts) so they
      // read as plain data at the call sites. This re-runs the SAME BT.601-inverse formula from the
      // module's OWN exported inputs (Y_LEVELS, BASE_CHROMA_OFFSETS, that version's CHROMA_SCALES)
      // and checks the literals match exactly, so no table can silently drift from its derivation
      // and no scale can be stated in two places.
      it('literals match their BT.601-inverse derivation exactly', () => {
        const scales = CHROMA_SCALES[version]!;
        const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
        const derived: number[][] = [];
        Y_LEVELS.forEach((y, band) => {
          for (const [cb0, cr0] of BASE_CHROMA_OFFSETS) {
            const cb = cb0 * scales[band]!, cr = cr0 * scales[band]!;
            derived.push([
              clamp255(y + 1.402 * cr),
              clamp255(y - 0.344136 * cb - 0.714136 * cr),
              clamp255(y + 1.772 * cb),
            ]);
          }
        });
        expect(derived).toEqual(pal.map((c) => [c[0], c[1], c[2]]));
      });

      // Clipping would drag a row's actual luma off its target, which is what caps each band's
      // usable chroma scale in the first place.
      it('no channel clips, so every entry sits on its band luma', () => {
        const scales = CHROMA_SCALES[version]!;
        Y_LEVELS.forEach((y, band) => {
          for (const [cb0, cr0] of BASE_CHROMA_OFFSETS) {
            const cb = cb0 * scales[band]!, cr = cr0 * scales[band]!;
            for (const raw of [y + 1.402 * cr, y - 0.344136 * cb - 0.714136 * cr, y + 1.772 * cb]) {
              expect(Math.round(raw)).toBeGreaterThanOrEqual(0);
              expect(Math.round(raw)).toBeLessThanOrEqual(255);
            }
          }
        });
      });
    });
  }

  it('header levels are 4 monotone grays', () => {
    const ys = HEADER_LEVELS.map((c) => rgbToYcc(c[0], c[1], c[2])[0]);
    for (let i = 1; i < 4; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThan(50);
  });

  it('resolves a palette per released version and refuses any other', () => {
    expect(paletteForVersion(1)).toBe(PALETTE16_V1);
    expect(paletteForVersion(2)).toBe(PALETTE16_V2);
    for (const v of [0, 3, 255]) expect(paletteForVersion(v)).toBeNull();
  });

  it('new codes are drawn with HEADER_VERSION\'s palette', () => {
    expect(PALETTE16).toBe(paletteForVersion(HEADER_VERSION));
  });

  // The whole point of v2. Within a band only chroma separates the four entries, so a band's
  // squared separation is 7072·scale² before RGB rounding; v1 left the two extreme bands at a
  // quarter of the middles' and a chain fails at its weakest link, so the surplus bought nothing
  // and only made the band garish. v2 brings the middles down to it.
  it('v2 drops the middles toward the weakest band without weakening it', () => {
    const v1 = bandSeparations(PALETTE16_V1);
    const v2 = bandSeparations(PALETTE16_V2);
    expect(v1).toEqual([1767, 7032, 7032, 1767]);
    expect(v2).toEqual([1801, 3438, 3438, 1801]);
    // Robustness is the worst band, and v2's is no worse than what already ships.
    expect(Math.min(...v2)).toBeGreaterThanOrEqual(Math.min(...v1));
    // Not leveled onto the bottleneck: bands that rarely misread keep a real margin over it,
    // which is what keeps the TOTAL error rate down behind an unchanged headline number.
    expect(Math.max(...v2)).toBeGreaterThan(Math.min(...v2) * 1.5);
    // ...but no band hoards a surplus the weakest link can never use.
    expect(Math.max(...v2)).toBeLessThan(Math.min(...v2) * 2.5);
    expect(Math.max(...v1)).toBeGreaterThan(Math.min(...v1) * 3.5);
  });

  // Band 0's chroma scale is capped by something outside the classifier: findFinders flood-fills
  // pixels under a channel sum of 100, and a data module that merges into an adjacent finder square
  // costs the whole finder pair (no reserved gap row/col separates them). The entry that pushes
  // both Cb and Cr negative is the one that darkens as band 0's scale rises, so that scale must
  // stay near the point where band 0 merely clears the bottleneck.
  it('keeps the darkest entry clear of the finder flood-fill threshold', () => {
    for (const [, pal] of VERSIONS) {
      const darkest = Math.min(...pal.map((c) => c[0] + c[1] + c[2]));
      expect(darkest).toBeGreaterThan(115);
    }
    // v2 gives up no more than a rounding step of v1's headroom.
    const sum = (p: readonly RGB[]) => Math.min(...p.map((c) => c[0] + c[1] + c[2]));
    expect(sum(PALETTE16_V1) - sum(PALETTE16_V2)).toBeLessThanOrEqual(2);
  });
});
