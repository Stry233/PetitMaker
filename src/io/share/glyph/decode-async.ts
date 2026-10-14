import { decodeGlyph } from './decode';
import { createWorkerClient } from '../../../platform/async/worker-client';
import type { GlyphDecodeReply, GlyphDecodeRequest } from './decode.worker';

/** Browser imports run recovery off the UI thread; callers retain ownership of their pixels. */
export interface PixelOwnership {
  /** Transfer the pixels; recovery reconstructs them if a failed worker detached the buffer. */
  recoverPixels: () => Promise<Uint8Array>;
}

export async function decodeGlyphAsync(rgba: Uint8Array, width: number, height: number, ownership?: PixelOwnership): Promise<Uint8Array | null> {
  const client = createWorkerClient<GlyphDecodeRequest, GlyphDecodeReply>({
    spawn: () => new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 0,
  });
  // A null reply is an unreadable image, an answer like any other.
  return client.request({
    message: { rgba, width, height },
    ...(ownership ? { transfer: [rgba.buffer] } : {}),
    fallback: async () => decodeGlyph(rgba.byteLength === 0 && ownership ? await ownership.recoverPixels() : rgba, width, height),
  });
}
