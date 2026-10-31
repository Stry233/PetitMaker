// @vitest-environment jsdom
import '../../../_support/pixi-env'; // for the 2D context the crop draws into, which jsdom does not have
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ROAD_TEXTURE_SIZE, roadTileCanvas, roadTileReady, __resetRoadTileCache,
} from '../../../../view/shared/road/tile-texture';

/** jsdom fetches nothing, so an Image there neither loads nor errors. This stand-in collects every load
 *  and lets the test decide when (and how) it ends. */
function stubImageLoads(): Array<{ onload?: () => void; onerror?: () => void }> {
  const loads: Array<{ onload?: () => void; onerror?: () => void }> = [];
  vi.stubGlobal('Image', class {
    onload?: () => void;
    onerror?: () => void;
    set src(_url: string) { loads.push(this); }
  });
  return loads;
}

afterEach(() => { vi.unstubAllGlobals(); __resetRoadTileCache(); });

describe('road tile texture', () => {
  it('crops the icon art\'s transparent margin away, at any icon resolution', () => {
    // Bounds only: the margin each shipped PNG needs cleared cannot be measured here (jsdom decodes no
    // image). 15 is the smallest crop that leaves every shipped tile fully opaque; past ~24 the crop
    // magnifies the art enough to read as a different tile.
    expect(ROAD_TEXTURE_SIZE).toBe(128); // power of two: repeat wrapping needs it on WebGL1
    const loads = stubImageLoads();
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never);
    expect(roadTileCanvas('/x/d.png')).toBeUndefined();
    Object.assign(loads[0]!, { width: 256, height: 256 });
    loads[0]!.onload!();
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = drawImage.mock.calls[0] as number[];
    const inset = sx! * (ROAD_TEXTURE_SIZE / 256); // in the 128 px art the margin was measured in
    expect(inset).toBeGreaterThanOrEqual(15);
    expect(inset).toBeLessThan(24);
    expect([sy, sw, sh]).toEqual([sx, 256 - 2 * sx!, 256 - 2 * sx!]);
    expect([dx, dy, dw, dh]).toEqual([0, 0, ROAD_TEXTURE_SIZE, ROAD_TEXTURE_SIZE]);
  });

  it('loads a url once however many surfaces ask, and tells each of them when the art lands', () => {
    const loads = stubImageLoads();
    const first = vi.fn();
    const second = vi.fn();
    expect(roadTileCanvas('/x/a.png', first)).toBeUndefined();
    expect(roadTileCanvas('/x/a.png', second)).toBeUndefined();
    expect(loads, 'the second ask joined the load already in flight').toHaveLength(1);

    loads[0]!.onload!();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(roadTileCanvas('/x/a.png'), 'the art is the answer from here on').toBeDefined();
    expect(loads, 'and asking again loads nothing').toHaveLength(1);
  });

  it('answers a waiter on a failed load, and the next ask loads again', async () => {
    __resetRoadTileCache();
    const loads = stubImageLoads();
    const redraw = vi.fn();

    expect(roadTileCanvas('/x/b.png', redraw)).toBeUndefined();
    const ready = roadTileReady('/x/b.png');
    expect(loads, 'the readiness waiter joined the load already in flight').toHaveLength(1);

    loads[0]!.onerror!();
    // A capture may end up drawing that road flat, but it must never be left waiting.
    await expect(ready).resolves.toBeUndefined();
    // The redraw subscriber has nothing to redraw with and would ask again the moment it is told, so
    // calling it would spin a failing url once per frame for the rest of the session.
    expect(redraw).not.toHaveBeenCalled();

    // Nothing remembers the failure: a blocked request must not flatten that material for good.
    expect(roadTileCanvas('/x/b.png', redraw)).toBeUndefined();
    expect(loads, 'the next ask starts a fresh load').toHaveLength(2);
  });

  it('still gets its art after a failed load: a material is never flattened for good', async () => {
    __resetRoadTileCache();
    const loads = stubImageLoads();

    const first = roadTileReady('/x/c.png');
    loads[0]!.onerror!();
    await first;

    const redraw = vi.fn();
    expect(roadTileCanvas('/x/c.png', redraw)).toBeUndefined();
    expect(loads).toHaveLength(2);
    loads[1]!.onload!();
    expect(redraw, 'the surfaces standing in colour are told to draw again').toHaveBeenCalled();
    expect(roadTileCanvas('/x/c.png'), 'and the art is the answer from here on').toBeDefined();
  });
});
