import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../../../../io/stylize/neural/tensor', () => ({
  modelSize: () => ({ width: 8, height: 8 }),
  rgbaToTensor: () => new Float32Array(192),
  tensorToRgba: () => new Uint8ClampedArray(256),
}));
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('keeps active and recently closed consumers warm, then releases an idle runtime without touching takes', async () => {
  vi.resetModules(); vi.useFakeTimers();
  const workers: { terminate: ReturnType<typeof vi.fn>; onmessage?: (event: { data: unknown }) => void; id?: number }[] = [];
  vi.stubGlobal('Worker', class {
    terminate = vi.fn(); onmessage?: (event: { data: unknown }) => void; id?: number;
    constructor() { workers.push(this); }
    postMessage({ id }: { id: number }) { this.id = id; }
  });
  const source = document.createElement('canvas'); source.width = source.height = 8;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({}, {
    get: (_target, key) => key === 'getImageData' ? () => ({ data: new Uint8ClampedArray(256) }) : () => {},
  }) as never);
  vi.stubGlobal('ImageData', class {});
  const { retainNeuralRuntime } = await import('../../../../io/stylize/neural/lifecycle');
  const { stylizeNeural } = await import('../../../../io/stylize/neural/session');
  const release = retainNeuralRuntime();
  const run = stylizeNeural(source, 'watercolor', '#ffffff');
  release();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(workers[0]!.terminate).not.toHaveBeenCalled();
  workers[0]!.onmessage?.({ data: { id: workers[0]!.id, ok: true, width: 8, height: 8, data: new Float32Array(192), backend: 'wasm' } });
  const output = await run;
  await vi.advanceTimersByTimeAsync(20_000);
  const reopened = retainNeuralRuntime();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(workers[0]!.terminate).not.toHaveBeenCalled();
  reopened();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  expect(output.width).toBeGreaterThan(0);
});
