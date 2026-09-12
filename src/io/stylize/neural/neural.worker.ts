/*
 * The inference worker: one message in (a model URL and an RGB tensor), one message out (the
 * stylized tensor). Sessions are kept per model URL, so a second take of the same style pays no
 * load. The runtime is onnxruntime-web. Where the worker has a WebGPU adapter it runs the WebGPU
 * backend (the asyncify build, 25.7 MB, just under the static hosts' 25 MiB per-file limit);
 * everywhere else, and whenever WebGPU fails to load or run a model, the single-threaded WASM
 * build is the floor (the page is not cross-origin isolated, so there are no threads). Every
 * binary ships with the app and is addressed by URL, which keeps the runtime inside
 * `script-src 'self'`.
 */
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import gpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import gpuMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

type Ort = typeof import('onnxruntime-web');
type Backend = 'webgpu' | 'wasm';
type Runtime = { ort: Ort; backend: Backend };
type In = { id: number; modelUrl: string; width: number; height: number; data: Float32Array };
type Out = { id: number; ok: true; data: Float32Array; width: number; height: number; backend: Backend; gpuError?: string } | { id: number; ok: false; error: string };

const scope = self as unknown as { onmessage: ((e: MessageEvent<In>) => void) | null; postMessage(msg: Out, transfer?: Transferable[]): void };

const runtimes = new Map<Backend, Promise<Runtime>>();
/** Why WebGPU was not used, when it was not: for the harness, and for a bug report. */
let gpuError: string | undefined;
const sessions = new Map<string, Promise<{ session: import('onnxruntime-web').InferenceSession; runtime: Runtime }>>();

async function hasGpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  return !!(await gpu.requestAdapter().catch(() => null));
}

/** Errors only. The runtime's warnings describe its own choices (it keeps shape arithmetic on the
 *  CPU beside a GPU session by design) and each arrives with a full stack, which is noise for anyone
 *  with the console open. */
function quiet(ort: Ort): void {
  ort.env.logLevel = 'error';
}

function runtime(backend: Backend): Promise<Runtime> {
  let r = runtimes.get(backend);
  if (!r) {
    r = (async () => {
      if (backend === 'webgpu') {
        const ort = await import('onnxruntime-web/webgpu');
        ort.env.wasm.numThreads = 1;
        ort.env.wasm.wasmPaths = { wasm: gpuWasmUrl, mjs: gpuMjsUrl };
        quiet(ort as unknown as Ort);
        return { ort: ort as unknown as Ort, backend };
      }
      const ort = await import('onnxruntime-web');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmMjsUrl };
      quiet(ort);
      return { ort, backend };
    })();
    runtimes.set(backend, r);
    r.catch(() => runtimes.delete(backend));
  }
  return r;
}

async function open(modelUrl: string, backend: Backend) {
  const rt = await runtime(backend);
  const session = await rt.ort.InferenceSession.create(modelUrl, { executionProviders: [backend] });
  return { session, runtime: rt };
}

function cacheSession(modelUrl: string, promise: ReturnType<typeof open>) {
  sessions.set(modelUrl, promise);
  void promise.catch(() => {
    if (sessions.get(modelUrl) === promise) sessions.delete(modelUrl);
  });
  return promise;
}

function session(modelUrl: string) {
  let s = sessions.get(modelUrl);
  if (!s) {
    s = (async () => {
      if (await hasGpu()) {
        try { return await open(modelUrl, 'webgpu'); } catch (err) { gpuError = err instanceof Error ? err.message : String(err); }
      } else {
        gpuError = 'no WebGPU adapter in the worker';
      }
      return open(modelUrl, 'wasm');
    })();
    cacheSession(modelUrl, s);
  }
  return s;
}

async function run(modelUrl: string, data: Float32Array, width: number, height: number) {
  const { session: sess, runtime: rt } = await session(modelUrl);
  const input = new rt.ort.Tensor('float32', data, [1, 3, height, width]);
  let result: import('onnxruntime-web').InferenceSession.ReturnType | undefined;
  try {
    result = await sess.run({ [sess.inputNames[0]!]: input });
    const out = result[sess.outputNames[0]!]!;
    const [, , h, w] = out.dims as number[];
    return { data: (await out.getData()) as Float32Array, width: w!, height: h!, backend: rt.backend };
  } finally {
    input.dispose();
    for (const tensor of Object.values(result ?? {})) tensor.dispose();
  }
}

scope.onmessage = async (e: MessageEvent<In>) => {
  const { id, modelUrl, width, height, data } = e.data;
  try {
    let r: Awaited<ReturnType<typeof run>>;
    try {
      r = await run(modelUrl, data, width, height);
    } catch (err) {
      // A WebGPU session that opened but cannot run this model (an unsupported op, a lost device)
      // is replaced by a WASM one, once; a WASM failure is the answer.
      const cur = await sessions.get(modelUrl)?.catch(() => null);
      if (!cur || cur.runtime.backend === 'wasm') throw err;
      gpuError = err instanceof Error ? err.message : String(err);
      sessions.delete(modelUrl);
      // Release GPU allocations before the fallback creates another model session.
      await cur.session.release();
      cacheSession(modelUrl, open(modelUrl, 'wasm'));
      r = await run(modelUrl, data, width, height);
    }
    scope.postMessage({ id, ok: true, ...r, ...(gpuError ? { gpuError } : {}) }, [r.data.buffer]);
  } catch (err) {
    scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
