// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { FALLBACK_BYTES, loadWeights } from '../../../../ui/shell/splash/weights';
import { ASSET_SIZES_FILE } from '../../../../platform/build/asset-sizes';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('the splash weights', () => {
  it('weigh by kind once the size manifest has not answered for 3 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    let weigh: Awaited<ReturnType<typeof loadWeights>> | null = null;
    void loadWeights().then((w) => { weigh = w; });
    await vi.advanceTimersByTimeAsync(2_900);
    expect(weigh, 'still waiting for the manifest').toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(weigh).not.toBeNull();
    expect(weigh!('art', '/assets/a.png')).toBe(FALLBACK_BYTES.art);
    expect(weigh!('font', '/assets/f.woff2')).toBe(FALLBACK_BYTES.font);
  });

  it('weigh a file by its manifest size under a base path other than the root', async () => {
    vi.stubEnv('BASE_URL', '/sub/');
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requested.push(url);
      return new Response(JSON.stringify({ 'assets/f.woff2': 5_000_000 }));
    }));
    const weigh = await loadWeights();
    expect(requested).toEqual([`/sub/${ASSET_SIZES_FILE}`]);
    expect(weigh('font', '/sub/assets/f.woff2')).toBe(5_000_000);
    expect(weigh('font', new URL('/sub/assets/f.woff2', location.href).href)).toBe(5_000_000);
    expect(weigh('art', '/sub/assets/missing.png')).toBe(FALLBACK_BYTES.art);
  });
});
