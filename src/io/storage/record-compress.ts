import { packRecordBytes } from './record-codec';
import { createWorkerClient, type WorkerFailure } from '../../platform/async/worker-client';
import type { CompressReply, CompressRequest } from './record-compress.worker';

const FAILURE_MESSAGE: Partial<Record<WorkerFailure['kind'], string>> = {
  timeout: 'Autosave compression timed out',
  crash: 'Autosave worker failed',
  unreadable: 'Autosave worker response failed',
};

/** A large save's compression runs in a disposable same-origin worker. */
export async function encodeRecordInWorker(json: string, signal: AbortSignal): Promise<string> {
  const client = createWorkerClient<CompressRequest, CompressReply>({
    spawn: () => new Worker(new URL('./record-compress.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 0,
  });
  const bytes = new TextEncoder().encode(json);
  const packed = await client.request({
    message: bytes, transfer: [bytes.buffer], signal, timeoutMs: 15_000,
    fallback: (failure) => {
      const message = FAILURE_MESSAGE[failure.kind];
      throw message ? new Error(message) : failure.cause ?? failure;
    },
  });
  return packRecordBytes(packed);
}
