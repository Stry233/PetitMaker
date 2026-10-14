// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { surfaceImage, surfaceImageReady } from '../../../../view/shared/road/surface-image';
import type { RoadImagePattern } from '../../../../config/catalog/road-material';
import { stubCanvasContext } from '../../../_support/canvas-context';

vi.mock('../../../../assets/surface-urls', () => ({ surfaceUrl: (name: string) => `/surfaces/${name}.png` }));

const requests: Array<{ onload: (() => void) | null; onerror: (() => void) | null }> = [];
function imageEnvironment() {
  requests.length = 0;
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { requests.push(this); }
  });
  const drawImage = vi.fn();
  stubCanvasContext({ clearRect: vi.fn(), drawImage });
  return drawImage;
}
const pattern = (image: string): RoadImagePattern => ({ kind: 'image', repeat: 2, image });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('surface image readiness', () => {
  it('shares one decode and canvas while notifying both renderers', async () => {
    const draw = imageEnvironment(), first = vi.fn(), second = vi.fn();
    const material = pattern('shared-texture');
    const canvas = surfaceImage(material, first);
    expect(surfaceImage(material, second)).toBe(canvas);
    surfaceImage(material, first);
    let ready = false;
    const settled = surfaceImageReady(material).then(() => { ready = true; });
    await Promise.resolve();
    expect(ready).toBe(false);
    expect(requests).toHaveLength(1);
    requests[0]!.onload!();
    await settled;
    expect(draw).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(surfaceImage(material)).toBe(canvas);
  });

  it('allows export to finish after an unavailable image and retries on the same canvas', async () => {
    imageEnvironment();
    const material = pattern('retry-texture'), uploaded = vi.fn();
    const canvas = surfaceImage(material, uploaded);
    const settled = surfaceImageReady(material);
    requests[0]!.onerror!();
    await settled;
    expect(uploaded).not.toHaveBeenCalled();
    expect(surfaceImage(material, uploaded)).toBe(canvas);
    expect(requests).toHaveLength(2);
    requests[1]!.onload!();
    await surfaceImageReady(material);
    expect(uploaded).toHaveBeenCalledOnce();
  });
});
