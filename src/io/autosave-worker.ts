import { packAutosaveBytes } from './autosave-codec';
import { createWorkerClient, type WorkerFailure } from '../core/runtime/worker-client';

const FAILURE_MESSAGE: Partial<Record<WorkerFailure['kind'], string>> = {
  timeout: 'Autosave compression timed out',
  crash: 'Autosave worker failed',
  unreadable: 'Autosave worker response failed',
};

/** A large save's compression runs in a disposable same-origin worker. */
export async function encodeAutosaveInWorker(json: string, signal: AbortSignal): Promise<string> {
  const client = createWorkerClient({
    spawn: () => new Worker(new URL('./autosave.worker.ts', import.meta.url), { type: 'module' }),
    idleMs: 0,
  });
  const bytes = new TextEncoder().encode(json);
  const packed = await client.request<Uint8Array>({
    message: bytes, transfer: [bytes.buffer], signal, timeoutMs: 15_000,
    fallback: (failure) => {
      const message = FAILURE_MESSAGE[failure.kind];
      throw message ? new Error(message) : failure.cause ?? failure;
    },
  });
  return packAutosaveBytes(packed);
}
