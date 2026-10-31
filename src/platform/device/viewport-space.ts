/** Optional inset for the page. Editor coordinates are measured from the inset box's top left. */
interface ViewportSpace {
  width: number;
  height: number;
  left: number;
  top: number;
}
interface ViewportRect { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number }
let space: ViewportSpace | null = null;
/** The window size every reader shares: one snapshot, replaced only when an axis moves, behind one
 *  `resize` and `visualViewport` listener pair held while anything subscribes, so a resize tells every
 *  reader in one pass and React commits them together. */
let sized: { width: number; height: number } | null = null;
const sizeListeners = new Set<() => void>();

export function setViewportSpace(next: ViewportSpace | null): void {
  space = next;
  if (sizeListeners.size > 0) onWindowResize();
}
export function viewportSize(): { width: number; height: number } {
  return space ? { width: space.width, height: space.height } : { width: window.innerWidth, height: window.innerHeight };
}

/** Reads the window afresh, keeping the snapshot's identity while neither axis moved. */
function readSize(): { width: number; height: number } {
  const next = viewportSize();
  if (!sized || sized.width !== next.width || sized.height !== next.height) sized = next;
  return sized;
}

/** The shared window size: while anything subscribes, the snapshot its listeners keep, so a reader in
 *  a frame that has written styles never makes the browser lay out again to answer `innerWidth`;
 *  read afresh otherwise. For `useSyncExternalStore` and the per-frame writers alike. */
export function viewportSizeSnapshot(): { width: number; height: number } {
  return sizeListeners.size > 0 && sized ? sized : readSize();
}

function onWindowResize(): void {
  const was = sized;
  if (readSize() === was) return;
  for (const listener of [...sizeListeners]) listener();
}

/** Calls `listener` when the window size changes; returns the unsubscribe. */
export function subscribeViewportSize(listener: () => void): () => void {
  if (sizeListeners.size === 0) {
    window.addEventListener('resize', onWindowResize);
    window.visualViewport?.addEventListener('resize', onWindowResize);
    readSize();
  }
  sizeListeners.add(listener);
  return () => {
    sizeListeners.delete(listener);
    if (sizeListeners.size > 0) return;
    window.removeEventListener('resize', onWindowResize);
    window.visualViewport?.removeEventListener('resize', onWindowResize);
  };
}
export function toClientPoint(x: number, y: number): { x: number; y: number } {
  return space ? { x: x + space.left, y: y + space.top } : { x, y };
}

/** Native and React events carry client coordinates; cached pointer samples are already local. */
export function clientPoint(event: { clientX: number; clientY: number; nativeEvent?: unknown }): { x: number; y: number } {
  const native = event.nativeEvent ?? event;
  return space && typeof MouseEvent !== 'undefined' && native instanceof MouseEvent
    ? { x: event.clientX - space.left, y: event.clientY - space.top }
    : { x: event.clientX, y: event.clientY };
}

export function toLayoutRect(rect: ViewportRect): ViewportRect {
  if (!space) return rect;
  const left = rect.left - space.left, top = rect.top - space.top;
  const right = rect.right - space.left, bottom = rect.bottom - space.top;
  return { x: left, y: top, left, top, right, bottom, width: rect.width, height: rect.height };
}
export function viewportRect(element: Element): ViewportRect {
  return toLayoutRect(element.getBoundingClientRect());
}
