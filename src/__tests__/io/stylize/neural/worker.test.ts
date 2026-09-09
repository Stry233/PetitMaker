import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const inputs: { dispose: ReturnType<typeof vi.fn> }[] = [];
  const gpuCreate = vi.fn();
  const wasmCreate = vi.fn();
  const runtime = (create: typeof gpuCreate) => ({
    env: { wasm: {}, logLevel: 'warning' },
    InferenceSession: { create },
    Tensor: class {
      dispose = vi.fn();
      constructor() { inputs.push(this); }
    },
  });
  return { inputs, gpuCreate, wasmCreate, runtime };
});

vi.mock('onnxruntime-web/webgpu', () => mocks.runtime(mocks.gpuCreate));
vi.mock('onnxruntime-web', () => mocks.runtime(mocks.wasmCreate));

const scope = { onmessage: null as ((event: MessageEvent) => Promise<void>) | null, postMessage: vi.fn() };

function session() {
  const data = new Float32Array([0.2, 0.4, 0.6]);
  const output = { dims: [1, 3, 1, 1], getData: vi.fn().mockResolvedValue(data), dispose: vi.fn() };
  return {
    inputNames: ['input'], outputNames: ['output'],
    run: vi.fn().mockResolvedValue({ output }), release: vi.fn().mockResolvedValue(undefined),
    output, data,
  };
}

async function request(id = 1) {
  await scope.onmessage!(new MessageEvent('message', {
    data: { id, modelUrl: '/style.onnx', width: 8, height: 8, data: new Float32Array(3 * 8 * 8) },
  }));
  return scope.postMessage.mock.calls[scope.postMessage.mock.calls.length - 1]![0];
}

beforeEach(async () => {
  vi.resetModules();
  mocks.gpuCreate.mockReset();
  mocks.wasmCreate.mockReset();
  mocks.inputs.length = 0;
  scope.postMessage.mockClear();
  vi.stubGlobal('self', scope);
  vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
  await import('../../../../io/stylize/neural/neural.worker');
});
afterEach(() => vi.unstubAllGlobals());

describe('neural worker resource ownership', () => {
  it('disposes each take’s tensors while retaining its reusable model session', async () => {
    const gpu = session();
    mocks.gpuCreate.mockResolvedValue(gpu);
    const first = await request();
    expect(first).toMatchObject({ id: 1, ok: true, backend: 'webgpu', data: gpu.data });
    await request(2);
    expect(mocks.gpuCreate).toHaveBeenCalledTimes(1);
    expect(gpu.release).not.toHaveBeenCalled();
    expect(mocks.inputs).toHaveLength(2);
    for (const input of mocks.inputs) expect(input.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.output.dispose).toHaveBeenCalledTimes(2);
    expect(scope.postMessage.mock.calls[0]![1]).toEqual([gpu.data.buffer]);
    expect(Array.from(first.data)).toEqual(Array.from(gpu.data));
  });

  it('releases a failed GPU session before allocating the CPU fallback', async () => {
    const gpu = session(), wasm = session();
    gpu.run.mockRejectedValue(new Error('device lost'));
    let release!: () => void;
    gpu.release.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    mocks.gpuCreate.mockResolvedValue(gpu);
    mocks.wasmCreate.mockResolvedValue(wasm);
    const pending = request();
    await vi.waitFor(() => expect(gpu.release).toHaveBeenCalledTimes(1));
    expect(mocks.inputs[0]!.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.wasmCreate).not.toHaveBeenCalled();
    release();
    expect(await pending).toMatchObject({ ok: true, backend: 'wasm', gpuError: 'device lost' });
    expect(wasm.output.dispose).toHaveBeenCalledTimes(1);
    await request(2);
    expect(mocks.wasmCreate).toHaveBeenCalledTimes(1);
    expect(gpu.release).toHaveBeenCalledTimes(1);
  });

  it('disposes output tensors when downloading their pixels fails', async () => {
    const gpu = session(), wasm = session();
    gpu.output.getData.mockRejectedValue(new Error('download failed'));
    mocks.gpuCreate.mockResolvedValue(gpu);
    mocks.wasmCreate.mockResolvedValue(wasm);
    expect(await request()).toMatchObject({ ok: true, backend: 'wasm' });
    expect(gpu.output.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.release).toHaveBeenCalledTimes(1);
    for (const input of mocks.inputs) expect(input.dispose).toHaveBeenCalledTimes(1);
  });

  it('allows another attempt after the fallback model fails to load', async () => {
    const gpu = session(), wasm = session();
    gpu.run.mockRejectedValue(new Error('device lost'));
    mocks.gpuCreate.mockResolvedValue(gpu);
    mocks.wasmCreate.mockRejectedValueOnce(new Error('load failed')).mockResolvedValue(wasm);
    expect(await request()).toEqual({ id: 1, ok: false, error: 'load failed' });
    expect(await request(2)).toMatchObject({ id: 2, ok: true, backend: 'wasm' });
    expect(mocks.wasmCreate).toHaveBeenCalledTimes(2);
  });

  it('reports a CPU inference failure and disposes its input without retrying', async () => {
    vi.stubGlobal('navigator', {});
    const wasm = session();
    wasm.run.mockRejectedValue(new Error('cannot run'));
    mocks.wasmCreate.mockResolvedValue(wasm);
    expect(await request()).toEqual({ id: 1, ok: false, error: 'cannot run' });
    expect(wasm.run).toHaveBeenCalledTimes(1);
    expect(mocks.gpuCreate).not.toHaveBeenCalled();
    expect(mocks.inputs[0]!.dispose).toHaveBeenCalledTimes(1);
  });
});
