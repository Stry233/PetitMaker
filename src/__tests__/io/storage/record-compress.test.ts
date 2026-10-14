import { afterEach, expect, it, vi } from 'vitest';
import { gzipSync } from 'fflate';
import { decodeRecord } from '../../../io/storage/record-codec';
import { encodeRecordInWorker } from '../../../io/storage/record-compress';

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
  expect(decodeRecord(await encodeRecordInWorker(json, new AbortController().signal))).toBe(json);
  expect(terminate).toHaveBeenCalledOnce();
});
it('cancels a stalled worker without allowing its late reply to commit', async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  vi.stubGlobal('Worker', class { terminate = terminate; postMessage() {} });
  const controller = new AbortController();
  const result = encodeRecordInWorker('{}', controller.signal);
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await rejected;
  expect(terminate).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('names a broken worker and a stalled one in its errors', async () => {
  vi.useFakeTimers();
  const terminate = vi.fn();
  let fail = true;
  vi.stubGlobal('Worker', class {
    onerror?: () => void;
    terminate = terminate;
    postMessage() { if (fail) queueMicrotask(() => this.onerror?.()); }
  });
  await expect(encodeRecordInWorker('{}', new AbortController().signal)).rejects.toThrow('Autosave worker failed');
  fail = false;
  const stalled = expect(encodeRecordInWorker('{}', new AbortController().signal)).rejects.toThrow('Autosave compression timed out');
  await vi.advanceTimersByTimeAsync(15_000);
  await stalled;
  expect(terminate).toHaveBeenCalledTimes(2);
});
