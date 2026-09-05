import { decodeGlyph } from './decode';

/** Browser imports run recovery off the UI thread; callers retain ownership of their pixels. */
export async function decodeGlyphAsync(rgba: Uint8Array, width: number, height: number): Promise<Uint8Array | null> {
  if (typeof Worker === 'undefined') return decodeGlyph(rgba, width, height);
  let worker: Worker | undefined;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      worker!.onmessage = (event: MessageEvent<Uint8Array | null>) => resolve(event.data);
      worker!.onerror = () => reject(new Error('Image decoder worker failed'));
      worker!.onmessageerror = () => reject(new Error('Image decoder worker response failed'));
      worker!.postMessage({ rgba, width, height });
    });
  } catch {
    return decodeGlyph(rgba, width, height);
  } finally {
    worker?.terminate();
  }
}
