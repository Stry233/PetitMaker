/** Which ONNX backend this engine runs the students on: WebGPU where an adapter answers, else the
 *  single-threaded WASM build. Asked by the inference worker before it opens a session. */
import type { NeuralBackend } from './runtime-files';

export async function neuralBackend(): Promise<NeuralBackend> {
  const gpu = typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return 'wasm';
  return (await gpu.requestAdapter().catch(() => null)) ? 'webgpu' : 'wasm';
}

/** The backend a prefetch fetches ahead for: WebGPU where the engine names it. It asks for no adapter,
 *  since an engine that names WebGPU without one logs a warning at every request; where the worker then
 *  falls back to WASM, only the prefetched bytes are lost. */
export function neuralBackendGuess(): NeuralBackend {
  return typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
}
