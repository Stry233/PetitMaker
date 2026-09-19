import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let images: ProbeImage[];
class ProbeImage {
  naturalWidth = 2;
  naturalHeight = 1;
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { images.push(this); }
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  images = [];
  vi.stubGlobal('Image', ProbeImage);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('artwork decoder selection', () => {
  it('shares one local probe and settles on WebP only after successful decoding', async () => {
    const format = await import('../../assets/image-format');
    const first = format.prepareImageFormat();
    expect(format.prepareImageFormat()).toBe(first);
    expect(format.supportsLosslessWebp).toBe(false);
    expect(images).toHaveLength(1);
    expect(images[0]!.src).toMatch(/^data:image\/webp;base64,/);
    images[0]!.onload!();
    await first;
    expect(format.supportsLosslessWebp).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['error', 'wrong-size', 'timeout'])('uses PNG after %s and never changes URLs later', async failure => {
    const format = await import('../../assets/image-format');
    const ready = format.prepareImageFormat();
    const lateLoad = images[0]!.onload!;
    if (failure === 'error') images[0]!.onerror!();
    else if (failure === 'wrong-size') { images[0]!.naturalWidth = 0; lateLoad(); }
    else await vi.advanceTimersByTimeAsync(1500);
    await ready;
    expect(format.supportsLosslessWebp).toBe(false);
    images[0]!.naturalWidth = 2;
    lateLoad();
    expect(format.supportsLosslessWebp).toBe(false);
    expect(format.prepareImageFormat()).toBe(ready);
    expect(vi.getTimerCount()).toBe(0);
  });
});
