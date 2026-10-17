/**
 * The live 2D renderer, for what only it has: capturing the whole map, reconciling the object
 * layer with state, and its own viewport.
 *
 * A registry rather than a prop, for the same reason `active-view.ts` is one: the callers are the
 * export pipeline, the agent's snapshotter and the editor's own operations, none of which sit in
 * the React tree that owns the canvas.
 */
import type { MapRenderer } from './map-renderer';

let renderer: MapRenderer | null = null;
const listeners = new Set<() => void>();

export function setMapRenderer(next: MapRenderer | null): void {
  renderer = next;
  if (next) for (const listener of [...listeners]) listener();
}
export function getMapRenderer(): MapRenderer | null { return renderer; }

/** Calls `listener` each time a renderer is installed, so a picture asked for before one stood can
 *  be taken; returns the unsubscribe. */
export function onMapRenderer(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
