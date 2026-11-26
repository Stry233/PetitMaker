/** What the page fetches ahead for the on-device illustration is what its worker will load: the
 *  runtime of the backend this engine gets, and nothing where the students cannot run. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { neuralWarmUrls } from '../../../../pipelines/stylize/file-facts';
import { ORT_FILES } from '../../../../pipelines/stylize/neural/runtime-files';
import { MODEL_URLS } from '../../../../pipelines/stylize/neural/models';

vi.mock('wasm-feature-detect', () => ({ simd: async () => true }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('the illustration files fetched ahead', () => {
  it('are the WebGPU runtime where the engine names WebGPU, with the first neural style\'s weights', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
    expect(await neuralWarmUrls()).toEqual([ORT_FILES.webgpu.mjs, ORT_FILES.webgpu.wasm, MODEL_URLS.watercolor]);
  });

  /** An engine that names WebGPU but has no adapter logs a warning at every adapter request, on every page
   *  load if the prefetch asked; only a take asks, and a wrong guess costs no more than the bytes fetched. */
  it('never ask the engine for a GPU adapter, which only a take does', async () => {
    const requestAdapter = vi.fn(async () => null);
    vi.stubGlobal('navigator', { gpu: { requestAdapter } });
    expect((await neuralWarmUrls()).slice(0, 2)).toEqual([ORT_FILES.webgpu.mjs, ORT_FILES.webgpu.wasm]);
    expect(requestAdapter).not.toHaveBeenCalled();
  });

  it('are the WASM runtime where the engine has no WebGPU', async () => {
    vi.stubGlobal('navigator', {});
    expect((await neuralWarmUrls()).slice(0, 2)).toEqual([ORT_FILES.wasm.mjs, ORT_FILES.wasm.wasm]);
  });
});
