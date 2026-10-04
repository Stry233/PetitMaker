/**
 * The planet scan's decode worker: decodes one MP4 with WebCodecs for the scan worker at the other
 * end of the request's port (`decode-side.ts`), and answers once the scan has what it asked for.
 */
import { platformCodecs } from './decode-webcodecs';
import { serveFile } from './decode-side';
import { SCAN_PROFILE } from './profile';
import type { DecodeReply, DecodeRequest } from './protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DecodeRequest & { id: number }>) => void) | null;
  postMessage: (reply: DecodeReply & { id: number }) => void;
};

scope.onmessage = ({ data }) => {
  const { id, file, port } = data;
  const { width, height } = SCAN_PROFILE.frame;
  const done = () => { port.close(); scope.postMessage({ op: 'closed', id }); };
  // The scan reads a failure before opening as a file this path cannot decode.
  serveFile(file, port, platformCodecs(width, height)).then(done, (error: unknown) => {
    port.postMessage({ op: 'failed', pass: 1, message: String(error) });
    done();
  });
};
