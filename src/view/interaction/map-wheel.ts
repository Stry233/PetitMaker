/**
 * Controls that ride on the map (the selection card) stand outside the map's container, so wheel
 * input over them never reaches the map's own listener. The live pointer machine registers its wheel
 * handling here and such a control forwards the wheel it does not use itself, so a touchpad pan or
 * pinch keeps moving the map when the pointer crosses one.
 */
type WheelSink = (event: WheelEvent) => void;

let sink: WheelSink | null = null;

/** Marks a map view's host, which a pinch must reach to zoom the map. */
export const MAP_HOST_ATTR = 'data-map-host';
/** The attribute a map view spreads on its host. */
export const mapHostAttr: Readonly<Record<string, string>> = { [MAP_HOST_ATTR]: '' };

/** Whether the point under a wheel reaches a map view: hit testing passes through pointer-transparent
 *  chrome, so its target is then the map's host or inside it. */
export function reachesMap(event: Event): boolean {
  return event.target instanceof Element && event.target.closest(`[${MAP_HOST_ATTR}]`) !== null;
}

/** Register the map's wheel handling; returns the unregister. */
export function setMapWheelSink(next: WheelSink): () => void {
  sink = next;
  return () => { if (sink === next) sink = null; };
}

/** Hand a wheel event to the map. False when no map is listening. */
export function forwardMapWheel(event: WheelEvent): boolean {
  if (!sink) return false;
  sink(event);
  return true;
}
