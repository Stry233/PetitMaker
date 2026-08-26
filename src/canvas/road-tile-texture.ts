/*
 * road-tile-texture.ts — the ONE normalization from a path item's icon to its map texture.
 *
 * The wiki tile art is a rounded-corner 128px square: usable as-is on a card, not as a repeating
 * fill (transparent corners would punch holes at every cell boundary). Both renderers take the
 * same crop: ROAD_TEXTURE_INSET px cut from each edge (clears the corner arcs and their
 * anti-aliased fringe), resampled back to a 128px power-of-two canvas so repeat wrapping works
 * everywhere, WebGL1 included.
 *
 * The inset is a MEASURED number, not a geometric one: the art's transparent margin is wider than
 * its corner radius and varies per tile (some carry whole transparent rows along an edge). Measured
 * over the 25 shipped icons, 15 is the smallest crop with no translucent texel left anywhere; 16
 * ships, one pixel clear of the worst tile. The icon tooling's check reads this constant and
 * re-measures every shipped PNG against it, so a future icon with a wider margin fails there rather
 * than as pinholes at every macro-block corner on the map.
 */
export const ROAD_TEXTURE_SIZE = 128;
export const ROAD_TEXTURE_INSET = 16;

const cache = new Map<string, HTMLCanvasElement>();
/** Redraw subscribers: "this url now has art, draw the surfaces again". Run on SUCCESS only. */
const waiting = new Map<string, Array<() => void>>();
/** Readiness waiters (`roadTileReady`): "this url is settled, one way or the other". */
const settling = new Map<string, Array<() => void>>();

/**
 * One load is over. A redraw subscriber hears about it only when there is art to redraw with; a
 * readiness waiter hears either way, since what it is waiting for is the ANSWER.
 *
 * A failure is not remembered. Nothing is left to say a url is hopeless, so the next ask starts a
 * fresh load: one blocked request (an ad blocker, a CDN blip) must not flatten that material for the
 * rest of the session. It is also why a failure leaves the redraw subscribers unrun — a redraw with
 * nothing to draw with re-asks at once, and that pair would spin a failing url once per frame.
 */
function settle(url: string, art: HTMLCanvasElement | null): void {
  const subs = waiting.get(url) ?? [];
  waiting.delete(url);
  const readied = settling.get(url) ?? [];
  settling.delete(url);
  if (art) {
    cache.set(url, art);
    for (const cb of subs) cb();
  }
  for (const cb of readied) cb();
}

export function roadTileCanvas(url: string, onReady?: () => void): HTMLCanvasElement | undefined {
  const hit = cache.get(url);
  if (hit) return hit;
  const subs = waiting.get(url);
  if (subs) {
    if (onReady) subs.push(onReady);
    return undefined;
  }
  waiting.set(url, onReady ? [onReady] : []);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = ROAD_TEXTURE_SIZE;
    c.height = ROAD_TEXTURE_SIZE;
    const g = c.getContext('2d');
    if (!g) { settle(url, null); return; }
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const i = ROAD_TEXTURE_INSET * (img.width / ROAD_TEXTURE_SIZE);
    g.drawImage(img, i, i, img.width - 2 * i, img.height - 2 * i, 0, 0, ROAD_TEXTURE_SIZE, ROAD_TEXTURE_SIZE);
    settle(url, c);
  };
  img.onerror = () => settle(url, null);
  img.src = url;
  return undefined;
}

/**
 * Resolves once this url's tile art is croppable, or once that load has failed.
 *
 * The editor never needs it: a surface drawn in its colour redraws when the art lands. A CAPTURE is
 * one synchronous pass with no later frame, so a path material whose art has not decoded would be
 * photographed flat — the candidate cards' roads, drawn in a colour the map never shows. It resolves
 * on a failure as much as on a success: a capture may end up flat, but it must never hang.
 */
export function roadTileReady(url: string): Promise<void> {
  return new Promise((resolve) => {
    if (cache.has(url)) { resolve(); return; }
    // Registered BEFORE the load is asked for, so nothing can settle between the two.
    const readied = settling.get(url);
    if (readied) readied.push(resolve);
    else settling.set(url, [resolve]);
    roadTileCanvas(url);
  });
}

/** Test hook. */
export function resetRoadTileCacheForTest(): void {
  cache.clear();
  waiting.clear();
  settling.clear();
}
