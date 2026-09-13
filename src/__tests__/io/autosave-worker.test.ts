import { afterEach, expect, it, vi } from 'vitest';
import { gzipSync } from 'fflate';
import { decodeAutosave, encodeAutosaveInWorker } from '../../io/autosave-codec';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('transfers input and retires the worker after a round trip', async () => {
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class {
    onmessage?: (event: { data: Uint8Array }) => void;
    terminate = terminate;
    postMessage(input: Uint8Array, transfer: Transferable[]) {
      const received = structuredClone(input, { transfer });
      expect(input.byteLength).toBe(0);
      queueMicrotask(() => this.onmessage?.({ data: gzipSync(received) }));
    }
  });
  const json = '{"notes":"星布谷地"}';
  expect(decodeAutosave(await encodeAutosaveInWorker(json, new AbortController().signal))).toBe(json);
  expect(terminate).toHaveBeenCalledOnce();
});
it('cancels a stalled worker without allowing its late reply to commit', async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class { terminate = terminate; postMessage() {} });
  const controller = new AbortController();
  const result = encodeAutosaveInWorker('{}', controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
