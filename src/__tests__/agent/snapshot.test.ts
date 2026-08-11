import { describe, it, expect, afterEach } from 'vitest';
import { takeMapSnapshot } from '../../agent/snapshot';
import { setMapRenderer } from '../../canvas/map2d/renderer-registry';
import type { MapRenderer } from '../../canvas/map2d/map-renderer';

afterEach(() => setMapRenderer(null));

describe('map snapshot registry', () => {
  it('returns null when no renderer is registered', async () => {
    expect(await takeMapSnapshot()).toBeNull();
  });
  it('delegates to the registered renderer', async () => {
    setMapRenderer({ captureFullMap: () => 'data:image/png;base64,AAAA' } as unknown as MapRenderer);
    expect(await takeMapSnapshot()).toBe('data:image/png;base64,AAAA');
  });
});
