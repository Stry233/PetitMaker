import { describe, it, expect, afterEach, vi } from 'vitest';
import { takeMapSnapshot } from '../../../agent/exec/snapshot';
import { setMapRenderer } from '../../../view/map2d/scene/renderer-registry';
import type { MapRenderer } from '../../../view/map2d/scene/map-renderer';

afterEach(() => setMapRenderer(null));

describe('map snapshot registry', () => {
  it('returns null when no renderer is registered', async () => {
    expect(await takeMapSnapshot()).toBeNull();
  });
  it('takes the whole-map export capture, which leaves out the camera and editor marks', async () => {
    const captureImage = vi.fn(() => 'data:image/png;base64,AAAA');
    setMapRenderer({ captureImage } as unknown as MapRenderer);
    expect(await takeMapSnapshot()).toBe('data:image/png;base64,AAAA');
    expect(captureImage).toHaveBeenCalledWith({ maxPx: 1024 });
  });
});
