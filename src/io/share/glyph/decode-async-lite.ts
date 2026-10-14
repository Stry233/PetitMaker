import { decodeGlyph } from './decode';
import { afterPaint } from '../../../platform/async/after-paint';
export type { PixelOwnership } from './decode-async';

/** Let the import progress paint before bounded recovery on the container's main thread. */
export async function decodeGlyphAsync(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
  await afterPaint();
  return decodeGlyph(rgba, width, height);
}
