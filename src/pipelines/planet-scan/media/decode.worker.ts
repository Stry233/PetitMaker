/**
 * The planet scan's decode worker: decodes one video file with WebCodecs for the scan worker at
 * the other end of the request's port (`decode-side.ts`), and answers once the scan has what it
 * asked for.
 */
import { platformCodecs } from './decode-webcodecs';
import { serveFile } from './decode-side';
import { SCAN_PROFILE } from '../profile';
import { workerScope, type Keyed } from '../../../platform/async/worker-client';

/** To the decode worker: decode `file` for the scan worker at the other end of `port`. Answered
 *  `closed` once the scan has every frame it asked for, or the decoder gave up. */
export type DecodeRequest = { readonly op: 'open'; readonly file: Blob; readonly port: MessagePort };
export type DecodeReply = { readonly op: 'closed' };

const scope = workerScope<Keyed<DecodeRequest>, Keyed<DecodeReply>>();
scope.listen(({ id, file, port }) => {
  const { width, height } = SCAN_PROFILE.frame;
  const done = () => { port.close(); scope.post({ op: 'closed', id }); };
  // The scan reads a failure before opening as a file this path cannot decode.
  serveFile(file, port, platformCodecs(width, height)).then(done, (error: unknown) => {
    port.postMessage({ op: 'failed', pass: 1, message: String(error) });
    done();
  });
});
