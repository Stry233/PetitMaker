import { decodeGlyph } from './decode';
import { workerScope } from '../../../platform/async/worker-client';

export type GlyphDecodeRequest = { rgba: Uint8Array; width: number; height: number };
/** The payload, or null for an image that carries no readable code. */
export type GlyphDecodeReply = Uint8Array | null;

const scope = workerScope<GlyphDecodeRequest, GlyphDecodeReply>();
scope.listen((data) => {
  scope.post(decodeGlyph(data.rgba, data.width, data.height));
});
