import { packAutosaveBytes } from './autosave-codec';

/** A large save's compression runs in a disposable same-origin worker. */
export function encodeAutosaveInWorker(json: string, signal: AbortSignal): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(new URL('./autosave.worker.ts', import.meta.url), { type: 'module' });
    let finished = false;
    const finish = (bytes?: Uint8Array, error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else {
        try { resolve(packAutosaveBytes(bytes!)); } catch (error) { reject(error); }
      }
    };
    const abort = () => finish(undefined, new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(undefined, new Error('Autosave compression timed out')), 15_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Uint8Array>) => finish(data);
    worker.onerror = () => finish(undefined, new Error('Autosave worker failed'));
    worker.onmessageerror = () => finish(undefined, new Error('Autosave worker response failed'));
    if (signal.aborted) { abort(); return; }
    const bytes = new TextEncoder().encode(json);
    try { worker.postMessage(bytes, [bytes.buffer]); } catch (error) { finish(undefined, error); }
  });
}
