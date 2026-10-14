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

export function setMapRenderer(next: MapRenderer | null): void { renderer = next; }
export function getMapRenderer(): MapRenderer | null { return renderer; }
