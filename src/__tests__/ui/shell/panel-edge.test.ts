/**
 * The edge a panel wears against the map: drawn in the map's ink at `MAP_EDGE_ALPHA`, it still reads
 * as a line on the plate it stands on.
 */
import { describe, it, expect } from 'vitest';
import { INK, MAP_EDGE_ALPHA, PLATE } from '../../../ui/design/tokens';
import { ZONE_COLORS } from '../../../core/model/palette';

/** WCAG relative luminance and the contrast ratio over it, for two opaque `rgb` triples. */
function luminance([r, g, b]: readonly [number, number, number]): number {
  const chan = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0]! + 0.7152 * chan[1]! + 0.0722 * chan[2]!;
}
function rgb(hex: string): readonly [number, number, number] {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as unknown as [number, number, number];
}
/** `over` composited under `ink` at `alpha`, which is what a translucent border actually shows:
 *  a background paints under its own border area, so the line is drawn on the plate. */
function composite(ink: string, alpha: number, over: string): readonly [number, number, number] {
  const [a, b] = [rgb(ink), rgb(over)];
  return [0, 1, 2].map((i) => alpha * a[i]! + (1 - alpha) * b[i]!) as unknown as [number, number, number];
}
function contrast(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

describe('the edge a panel wears', () => {
  /** A dilation's boundary carries the full `MAP_EDGE_ALPHA`, but a half-pixel border rasterizes at
   *  half coverage, so 1 px is the thinnest border at the same strength; wider reads as a keyline. */
  it('reads as a line on the plate it is drawn on, which is where it is faintest', () => {
    // 3:1, the WCAG ratio for a graphical indicator.
    expect(contrast(composite(INK, MAP_EDGE_ALPHA, PLATE), rgb(PLATE))).toBeGreaterThanOrEqual(3);
    // Against an empty sea, where cream on pale blue alone gives no boundary, the edge adds one.
    expect(contrast(composite(INK, MAP_EDGE_ALPHA, PLATE), rgb(ZONE_COLORS[0]!)))
      .toBeGreaterThan(contrast(rgb(PLATE), rgb(ZONE_COLORS[0]!)));
  });
});

