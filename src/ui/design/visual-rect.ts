/**
 * Element rects in screen pixels under CSS `zoom`. Chromium before 128 reports a zoomed subtree's
 * rects in that subtree's own CSS pixels; standardized engines report screen pixels. One probe at
 * first use decides which reading this engine gives, an element whose rect matches its own layout
 * box under zoom overrides that verdict for itself, and legacy readings are scaled back up.
 */

export interface VisualRect {
  x: number;
  y: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const PROBE_WIDTH = 200;
const PROBE_ZOOM = 0.5;

let rectsInScreenPx: boolean | null = null;

/** A 200px box under zoom 0.5 measures 100 on a standardized engine and 200 on a legacy one; a
 *  reading with no layout (jsdom) counts as screen pixels. */
function probe(): boolean {
  if (typeof document === 'undefined' || !document.body) return true;
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:0;top:0;width:${PROBE_WIDTH}px;height:10px;zoom:${PROBE_ZOOM};visibility:hidden;pointer-events:none`;
  document.body.appendChild(box);
  const width = box.getBoundingClientRect().width;
  box.remove();
  return Math.abs(width - PROBE_WIDTH) > 1;
}

/** Whether this engine reports zoomed rects in screen pixels. */
export function zoomedRectsAreVisual(): boolean {
  if (rectsInScreenPx === null) rectsInScreenPx = probe();
  return rectsInScreenPx;
}

/** Clears the cached probe so a test can pose another engine. */
export function __resetVisualRectProbe(): void {
  rectsInScreenPx = null;
}

/** The product of the element's own and every ancestor's computed `zoom`, and whether any of them is transformed. */
function zoomChain(el: Element): { zoom: number; transformed: boolean } {
  let zoom = 1;
  let transformed = false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    const own = parseFloat(style.zoom);
    if (own > 0) zoom *= own;
    if (style.transform && style.transform !== 'none') transformed = true;
  }
  return { zoom, transformed };
}

/** The product of the element's own and every ancestor's computed `zoom`. */
export function effectiveZoom(el: Element): number {
  return zoomChain(el).zoom;
}

/** A rect the width of the element's own layout box, under a zoom and free of transforms, can only be
 *  a reading in the element's pixels: the engine's convention is then known for this element itself. */
function ownPixelReading(el: Element, r: DOMRect): number | null {
  if (!(el instanceof HTMLElement) || el.offsetWidth === 0 || Math.abs(r.width - el.offsetWidth) > 1) return null;
  const { zoom, transformed } = zoomChain(el);
  return zoom !== 1 && !transformed ? zoom : null;
}

/** The nearest element around a range, which carries the zoom the range is measured under. */
function rangeContext(range: Range): Element | null {
  const node = range.commonAncestorContainer;
  return node instanceof Element ? node : node.parentElement;
}

/** The element's or range's rect in screen pixels on every engine. */
export function visualRect(target: Element | Range): VisualRect {
  const r = target.getBoundingClientRect();
  const own = target instanceof Element ? ownPixelReading(target, r) : null;
  if (own === null && zoomedRectsAreVisual()) return r;
  const context = target instanceof Element ? target : rangeContext(target);
  const z = own ?? (context ? effectiveZoom(context) : 1);
  if (z === 1) return r;
  return {
    x: r.left * z,
    y: r.top * z,
    left: r.left * z,
    top: r.top * z,
    right: r.right * z,
    bottom: r.bottom * z,
    width: r.width * z,
    height: r.height * z,
  };
}
