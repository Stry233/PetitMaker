import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { warmFiles } from '../../../../ui/shell/warm/files';
import { MAP_CHECK_DATA, mapCheckRuntimeUrls } from '../../../../pipelines/moderation/map/assets';
import { ORT_FILES } from '../../../../pipelines/stylize/neural/runtime-files';
import { MODEL_URLS } from '../../../../pipelines/stylize/neural/models';
import { allStyleSampleUrls } from '../../../../ui/chrome/modals/export/stylize/sample-assets';
import { SCAN_EXAMPLE } from '../../../../ui/chrome/modals/planet/scan-example';
import { DREAM_THUMBS } from '../../../../ui/agent/desk/dream-thumbs';

const simd = vi.hoisted(() => ({ value: true }));
vi.mock('wasm-feature-detect', () => ({ simd: async () => simd.value }));

const MANIFEST = {
  'pipelines/moderation/map/review.worker.ts': { chunks: ['assets/review.worker-1.js', 'assets/image-1.js'], assets: ['assets/every-variant.wasm'] },
  'pipelines/moderation/text/review.worker.ts': { chunks: ['assets/review.worker-2.js'], assets: [] },
  'pipelines/stylize/neural/neural.worker.ts': { chunks: ['assets/neural.worker-1.js'], assets: ['assets/ort-every-variant.wasm'] },
};

beforeEach(() => {
  vi.stubGlobal('__PETIT_WORKER_FILES__', btoa(JSON.stringify(MANIFEST)));
  vi.stubGlobal('location', { origin: 'https://site.example' });
});
afterEach(() => { vi.unstubAllGlobals(); simd.value = true; });

describe('the warm schedule\'s files', () => {
  it('fetches no worker code outside a web build, which carries no worker manifest', async () => {
    vi.stubGlobal('__PETIT_WORKER_FILES__', '');
    const { counted, background } = await warmFiles('full');
    const workerChunks = Object.values(MANIFEST).flatMap((files) => files.chunks.map((chunk) => `/${chunk}`));
    expect([...counted, ...background].filter((url) => workerChunks.includes(url))).toEqual([]);
  });

  it('fetches nothing on the minimal and none tiers', async () => {
    expect(await warmFiles('minimal')).toEqual({ counted: [], background: [] });
    expect(await warmFiles('none')).toEqual({ counted: [], background: [] });
  });

  it('counts every worker\'s code but the illustration worker\'s, one variant of each map check runtime, its data and the sample pictures', async () => {
    const { counted, background } = await warmFiles('core');
    expect(counted).toEqual(expect.arrayContaining([
      '/assets/review.worker-1.js', '/assets/image-1.js', '/assets/review.worker-2.js',
      ...mapCheckRuntimeUrls(true),
      ...MAP_CHECK_DATA.map((file) => `https://site.example/moderation/${file}`),
      ...allStyleSampleUrls(), ...Object.values(DREAM_THUMBS), SCAN_EXAMPLE.poster,
    ]));
    expect(counted).not.toContain('/assets/neural.worker-1.js');
    expect(counted).not.toContain('/assets/every-variant.wasm');
    expect(counted.filter((url) => url === SCAN_EXAMPLE.webm || url === SCAN_EXAMPLE.mp4)).toHaveLength(1);
    expect(background).toEqual([]);
  });

  it('adds one illustration runtime and the default style\'s weights in the background on the full tier', async () => {
    const { background } = await warmFiles('full');
    const backend = 'gpu' in navigator ? 'webgpu' : 'wasm';
    expect(background).toEqual(['/assets/neural.worker-1.js', ORT_FILES[backend].mjs, ORT_FILES[backend].wasm, MODEL_URLS.watercolor]);
  });

  it('leaves the illustration runtime out where the engine cannot run it', async () => {
    simd.value = false;
    expect((await warmFiles('full')).background).toEqual([]);
  });
});
