import { readGlyph, type GlyphRead } from './decode';
import { workerScope } from '../../../platform/async/worker-client';

export type GlyphDecodeRequest = { rgba: Uint8Array; width: number; height: number };
/** The payload, or why the image yielded none. */
export type GlyphDecodeReply = GlyphRead;

const scope = workerScope<GlyphDecodeRequest, GlyphDecodeReply>();
scope.listen((data) => {
  scope.post(readGlyph(data.rgba, data.width, data.height));
});
