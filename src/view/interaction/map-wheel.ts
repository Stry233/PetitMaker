/**
 * Controls that ride on the map (the selection card) stand outside the map's container, so wheel
 * input over them never reaches the map's own listener. The live pointer machine registers its wheel
 * handling here and such a control forwards the wheel it does not use itself, so a touchpad pan keeps
 * moving the map when the pointer crosses one. Ctrl+wheel is handled window-wide and never comes here.
 */
type WheelSink = (event: WheelEvent) => void;

let sink: WheelSink | null = null;

/** Register the map's plain-wheel handling; returns the unregister. */
export function setMapWheelSink(next: WheelSink): () => void {
  sink = next;
  return () => { if (sink === next) sink = null; };
}

/** Hand a wheel event to the map. False when no map is listening. */
export function forwardMapWheel(event: WheelEvent): boolean {
  if (!sink || event.ctrlKey) return false;
  sink(event);
  return true;
}
