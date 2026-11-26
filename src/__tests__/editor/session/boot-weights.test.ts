// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { loadWeights } from '../../../editor/session/boot-weights';
import { ASSET_SIZES_FILE } from '../../../platform/build/asset-sizes';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('the boot asset weights', () => {
  it('weigh by kind once the size manifest has not answered for 3 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    let weigh: Awaited<ReturnType<typeof loadWeights>> | null = null;
    void loadWeights().then((w) => { weigh = w; });
    await vi.advanceTimersByTimeAsync(2_900);
    expect(weigh, 'still waiting for the manifest').toBeNull();
    await vi.advanceTimersByTimeAsync(200);
    expect(weigh).not.toBeNull();
    // Unlisted, every file weighs as its kind does: a font far more than a picture.
    expect(weigh!('art', '/assets/a.png')).toBe(weigh!('art', '/assets/b.png'));
    expect(weigh!('font', '/assets/f.woff2')).toBeGreaterThan(weigh!('art', '/assets/a.png'));
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
    expect(weigh('art', '/sub/assets/missing.png')).toBe(weigh('art', '/sub/assets/other.png'));
    expect(weigh('art', '/sub/assets/missing.png')).toBeGreaterThan(0);
  });
});
