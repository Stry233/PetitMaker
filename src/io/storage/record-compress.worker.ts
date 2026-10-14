import { gzipSync } from 'fflate';
import { workerScope } from '../../platform/async/worker-client';

/** An autosave's JSON bytes in, transferred. */
export type CompressRequest = Uint8Array;
/** The same bytes gzipped, transferred back. */
export type CompressReply = Uint8Array;

const scope = workerScope<CompressRequest, CompressReply>();
scope.listen((data) => {
  const bytes = gzipSync(data, { level: 1 });
  scope.post(bytes, [bytes.buffer]);
});
