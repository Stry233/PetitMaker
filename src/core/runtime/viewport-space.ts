/** Optional presentation transform. Editor coordinates stay in a landscape layout space. */
export interface ViewportSpace {
  width: number;
  height: number;
  left: number;
  top: number;
  scale: number;
  rotated: boolean;
}
export interface ViewportRect { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number }
let space: ViewportSpace | null = null;

export function setViewportSpace(next: ViewportSpace | null): void { space = next; }
export function viewportSize(): { width: number; height: number } {
  return space ?? { width: window.innerWidth, height: window.innerHeight };
}
export function toLayoutPoint(x: number, y: number): { x: number; y: number } {
  if (!space) return { x, y };
  return space.rotated
    ? { x: (y - space.top) / space.scale, y: space.height - (x - space.left) / space.scale }
    : { x: (x - space.left) / space.scale, y: (y - space.top) / space.scale };
}
export function toClientPoint(x: number, y: number): { x: number; y: number } {
  if (!space) return { x, y };
  return space.rotated
    ? { x: space.left + (space.height - y) * space.scale, y: space.top + x * space.scale }
    : { x: space.left + x * space.scale, y: space.top + y * space.scale };
}
export function toLayoutDelta(x: number, y: number): { x: number; y: number } {
  if (!space) return { x, y };
  return space.rotated ? { x: y / space.scale, y: -x / space.scale } : { x: x / space.scale, y: y / space.scale };
}

/** Native and React events carry physical coordinates; cached pointer samples are already local. */
export function clientPoint(event: { clientX: number; clientY: number; nativeEvent?: unknown }): { x: number; y: number } {
  const native = event.nativeEvent ?? event;
  return space && typeof MouseEvent !== 'undefined' && native instanceof MouseEvent
    ? toLayoutPoint(event.clientX, event.clientY)
    : { x: event.clientX, y: event.clientY };
}

export function toLayoutRect(rect: ViewportRect): ViewportRect {
  if (!space) return rect;
  const a = toLayoutPoint(rect.left, rect.top), b = toLayoutPoint(rect.right, rect.bottom);
  const left = Math.min(a.x, b.x), top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x), bottom = Math.max(a.y, b.y);
  return { x: left, y: top, left, top, right, bottom, width: right - left, height: bottom - top };
}
export function viewportRect(element: Element): ViewportRect {
  return toLayoutRect(element.getBoundingClientRect());
}
