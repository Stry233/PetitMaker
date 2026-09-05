import { decodeGlyph } from './decode';

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ rgba: Uint8Array; width: number; height: number }>) => void) | null;
  postMessage(payload: Uint8Array | null): void;
};

scope.onmessage = ({ data }) => {
  scope.postMessage(decodeGlyph(data.rgba, data.width, data.height));
};
