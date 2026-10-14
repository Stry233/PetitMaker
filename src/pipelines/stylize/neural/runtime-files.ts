/**
 * The ONNX runtime's binaries for each backend, named once for the inference worker and for the
 * page's prefetch. The WebGPU backend needs the asyncify build; WASM uses the plain SIMD build.
 * URL imports only: nothing here loads the runtime.
 */
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import wasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import gpuWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import gpuMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';

export type NeuralBackend = 'webgpu' | 'wasm';

export const ORT_FILES: Record<NeuralBackend, { wasm: string; mjs: string }> = {
  webgpu: { wasm: gpuWasmUrl, mjs: gpuMjsUrl },
  wasm: { wasm: wasmUrl, mjs: wasmMjsUrl },
};
