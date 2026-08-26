import './_pixi-env'; // for the 2D context the crop draws into, which jsdom does not have
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  ROAD_TEXTURE_INSET, ROAD_TEXTURE_SIZE, roadTileCanvas, roadTileReady, resetRoadTileCacheForTest,
} from '../../canvas/road-tile-texture';

/** jsdom fetches nothing, so an Image there neither loads nor errors. Stand in for the browser's:
 *  every load is collected, and the test decides when (and how) it ends. */
function stubImageLoads(): Array<{ onload?: () => void; onerror?: () => void }> {
  const loads: Array<{ onload?: () => void; onerror?: () => void }> = [];
  vi.stubGlobal('Image', class {
    onload?: () => void;
    onerror?: () => void;
    set src(_url: string) { loads.push(this); }
  });
  return loads;
}

afterEach(() => { vi.unstubAllGlobals(); resetRoadTileCacheForTest(); });

describe('road tile texture', () => {
  it('inset clears the icon art transparent margin', () => {
    // Bounds only: what the crop must actually clear is a per-file measurement over the shipped
    // PNGs, which jsdom cannot make (it decodes no image) — the icon tooling's check reads this
    // constant and re-measures every icon against it. 15 was the smallest fully-opaque crop across
    // the 25 shipped tiles (the worst, path-blue-board, carries 4 wholly transparent rows and a
    // ~15px corner arc); past ~24 the crop magnifies the art enough to read as a different tile.
    expect(ROAD_TEXTURE_INSET).toBeGreaterThanOrEqual(15);
    expect(ROAD_TEXTURE_INSET).toBeLessThan(24);
    expect(ROAD_TEXTURE_SIZE).toBe(128); // power of two: repeat wrapping needs it on WebGL1
  });

  it('returns undefined before load and dedups callbacks per url', () => {
    resetRoadTileCacheForTest();
    const ready = vi.fn();
    expect(roadTileCanvas('/x/a.png', ready)).toBeUndefined();
    expect(roadTileCanvas('/x/a.png', ready)).toBeUndefined(); // second ask: same in-flight load
    expect(ready).not.toHaveBeenCalled(); // jsdom never fires Image load; no throw is the point
  });

  it('answers a waiter on a failed load, and the next ask loads again', async () => {
    resetRoadTileCacheForTest();
    const loads = stubImageLoads();
    const redraw = vi.fn();

    expect(roadTileCanvas('/x/b.png', redraw)).toBeUndefined();
    const ready = roadTileReady('/x/b.png');
    expect(loads, 'the readiness waiter joined the load already in flight').toHaveLength(1);

    loads[0]!.onerror!();
    // A capture may end up drawing that road flat, but it must never be left waiting.
    await expect(ready).resolves.toBeUndefined();
    // The redraw subscriber has nothing to redraw with, and asks again the moment it is told —
    // running it here is what would spin a failing url once per frame for the rest of the session.
    expect(redraw).not.toHaveBeenCalled();

    // Nothing remembers the failure: a blocked request must not flatten that material for good.
    expect(roadTileCanvas('/x/b.png', redraw)).toBeUndefined();
    expect(loads, 'the next ask starts a fresh load').toHaveLength(2);
  });

  it('still gets its art after a failed load: a material is never flattened for good', async () => {
    resetRoadTileCacheForTest();
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
