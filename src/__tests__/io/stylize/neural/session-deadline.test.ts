/**
 * A neural take waits on a worker that fetches a ~14 MB runtime before its first answer. Without a
 * deadline a stalled fetch leaves the take pending, and the studio's Generate verb disabled, for
 * the rest of the session.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('../../../../io/stylize/neural/tensor', () => ({
  modelSize: () => ({ width: 8, height: 8 }),
  rgbaToTensor: () => new Float32Array(192),
  tensorToRgba: () => new Uint8ClampedArray(256),
}));

interface FakeWorker { terminate: ReturnType<typeof vi.fn>; onmessage?: (event: { data: unknown }) => void; id?: number }
let workers: FakeWorker[] = [];

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  workers = [];
  vi.stubGlobal('Worker', class {
    terminate = vi.fn(); onmessage?: (event: { data: unknown }) => void; id?: number;
    constructor() { workers.push(this as unknown as FakeWorker); }
    postMessage({ id }: { id: number }) { this.id = id; }
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => new Proxy({}, {
    get: (_target, key) => key === 'getImageData' ? () => ({ data: new Uint8ClampedArray(256) }) : () => {},
  }) as never);
  vi.stubGlobal('ImageData', class {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function band(): HTMLCanvasElement {
  const source = document.createElement('canvas');
  source.width = source.height = 8;
  return source;
}

it('reports a device failure once a run passes its deadline, and drops the worker so the next attempt reloads', async () => {
  // `vi.resetModules` gives each test its own module graph, so the error class is taken from it.
  const { StylizeError } = await import('../../../../io/stylize/dialects/types');
  const { stylizeNeural, NEURAL_INFER_TIMEOUT_MS } = await import('../../../../io/stylize/neural/session');
  const fate = stylizeNeural(band(), 'watercolor', '#ffffff').then(() => 'painted', (err: unknown) => err);

  await vi.advanceTimersByTimeAsync(NEURAL_INFER_TIMEOUT_MS - 1);
  expect(workers[0]!.terminate).not.toHaveBeenCalled();

  await vi.advanceTimersByTimeAsync(1);
  const err = await fate;
  expect(err).toBeInstanceOf(StylizeError);
  expect((err as InstanceType<typeof StylizeError>).status).toBe('device');
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();

  void stylizeNeural(band(), 'watercolor', '#ffffff').catch(() => {});
  expect(workers, 'a fresh worker, so a transient stall does not end the session').toHaveLength(2);
});

it('leaves an answered run alone', async () => {
  const { stylizeNeural, NEURAL_INFER_TIMEOUT_MS } = await import('../../../../io/stylize/neural/session');
  const run = stylizeNeural(band(), 'watercolor', '#ffffff');
  workers[0]!.onmessage?.({ data: { id: workers[0]!.id, ok: true, width: 8, height: 8, data: new Float32Array(192), backend: 'wasm' } });
  const painted = await run;
  expect(painted.width).toBeGreaterThan(0);

  await vi.advanceTimersByTimeAsync(NEURAL_INFER_TIMEOUT_MS);
  expect(workers[0]!.terminate, 'only the idle lease retires a healthy worker').toHaveBeenCalledOnce();
});
