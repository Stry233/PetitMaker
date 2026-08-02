/**
 * Browser page zoom, measured against where this page started.
 *
 * `devicePixelRatio` is the display's own scaling multiplied by the page zoom, and nothing exposed
 * to a page can separate the two. So the only way to know the zoom is to remember the ratio at load,
 * before any zooming has happened in this page's life, and read every later change against it.
 *
 * The consequence, stated plainly: a page LOADED at 130% takes 130% as its zero, so it matches a
 * page loaded at 100%. That is the right trade — using the zoom control is a deliberate act that
 * should not resize the interface or the map, while the zoom a user happens to leave set for other
 * sites says nothing about this one.
 *
 * Both consumers read from here: the menu scale (so the UI holds its size) and the 2D viewport (so
 * the map holds its scale, and the two views agree about how big the world is).
 */

function currentDpr(): number {
  return (typeof window === 'undefined' ? 1 : window.devicePixelRatio) || 1;
}

const BASE_DPR = currentDpr();

/** Page zoom relative to page load. 1 when nothing has been zoomed. */
export function pageZoom(dpr: number = currentDpr()): number {
  return dpr / BASE_DPR;
}
