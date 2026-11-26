import { describe, it, expect, afterEach, vi } from 'vitest';
import { takeMapRegionSnapshot, takeMapSnapshot } from '../../../agent/exec/snapshot';
import { setMapRenderer } from '../../../view/map2d/scene/renderer-registry';
import type { MapRenderer } from '../../../view/map2d/scene/map-renderer';
import { makeState } from '../../_support/map-state';

afterEach(() => setMapRenderer(null));

/** A renderer whose off-stage capture answers with a picture named after the map it was handed. */
function rendererNaming(names: Map<object, string>) {
  const captureState = vi.fn(async (state: object) => ({ toDataURL: () => `data:${names.get(state)}` }));
  setMapRenderer({ captureState } as unknown as MapRenderer);
  return captureState;
}

describe('the assistant map pictures', () => {
  it('are null when no renderer is registered', async () => {
    expect(await takeMapSnapshot(makeState(8, 8))).toBeNull();
  });

  it('draw the map they are handed, whole or framed on a clamped rect', async () => {
    const map = makeState(10, 10);
    const capture = rendererNaming(new Map([[map, 'job-map']]));
    expect(await takeMapSnapshot(map)).toBe('data:job-map');
    expect(await takeMapRegionSnapshot(map, { x1: 8, y1: -3, x2: 14, y2: 2 })).toBe('data:job-map');
    expect(capture).toHaveBeenLastCalledWith(map, expect.objectContaining({ frame: { x: 8, y: 0, width: 2, height: 3 } }));
  });
});
