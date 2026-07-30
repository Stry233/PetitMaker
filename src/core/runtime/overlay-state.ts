// Tracks how many BLOCKING overlays (modals) are open. While any is open the map sits behind a
// blurred backdrop, so global keyboard shortcuts (map WASD/arrow pan, UI zoom, tool keys, delete)
// should suppress themselves — the user is interacting with the popup, not the map.
// Modals acquire a lock for as long as they're open; the shortcut handlers read anyOverlayOpen().
let openCount = 0;

export function anyOverlayOpen(): boolean {
  return openCount > 0;
}

/** Register an open overlay. Returns a release function (idempotent) — call it when the overlay closes. */
export function acquireOverlayLock(): () => void {
  openCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openCount = Math.max(0, openCount - 1);
  };
}
