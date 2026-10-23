import { readGlyph, type GlyphRead } from './decode';
import { createWorkerClient } from '../../../platform/async/worker-client';
import type { GlyphDecodeReply, GlyphDecodeRequest } from './decode.worker';

/** Browser imports run recovery off the UI thread; callers retain ownership of their pixels. */
export interface PixelOwnership {
  /** Transfer the pixels; recovery reconstructs them if a failed worker detached the buffer. */
  recoverPixels: () => Promise<Uint8Array>;
}

export async function decodeGlyphAsync(rgba: Uint8Array, width: number, height: number, ownership?: PixelOwnership): Promise<GlyphRead> {
  const client = createWorkerClient<GlyphDecodeRequest, GlyphDecodeReply>({
    spawn: () => new Worker(new URL('./decode.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 0,
  });
  // A read without a payload is an answer like any other.
  return client.request({
    message: { rgba, width, height },
    ...(ownership ? { transfer: [rgba.buffer] } : {}),
    fallback: async () => readGlyph(rgba.byteLength === 0 && ownership ? await ownership.recoverPixels() : rgba, width, height),
  });
}
