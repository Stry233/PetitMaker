import { decodeGlyph } from './decode';
export type { PixelOwnership } from './decode-async';

/** Let the import progress paint before bounded recovery on the container's main thread. */
export async function decodeGlyphAsync(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
  await new Promise<void>(resolve => requestAnimationFrame(() => { setTimeout(resolve, 0); }));
  return decodeGlyph(rgba, width, height);
}
