import { decodeGlyph } from './decode';
import { createWorkerClient } from '../../../core/runtime/worker-client';

/** Browser imports run recovery off the UI thread; callers retain ownership of their pixels. */
export interface PixelOwnership {
  /** Transfer the pixels; recovery reconstructs them if a failed worker detached the buffer. */
  recoverPixels: () => Promise<Uint8Array>;
}

export async function decodeGlyphAsync(rgba: Uint8Array, width: number, height: number, ownership?: PixelOwnership): Promise<Uint8Array | null> {
  const client = createWorkerClient({
    spawn: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 0,
  });
  return client.request<Uint8Array | null>({
    message: { rgba, width, height },
    ...(ownership ? { transfer: [rgba.buffer] } : {}),
    // A null reply is an unreadable image, an answer like any other.
    read: (data) => data as Uint8Array | null,
    fallback: async () => decodeGlyph(rgba.byteLength === 0 && ownership ? await ownership.recoverPixels() : rgba, width, height),
  });
}
