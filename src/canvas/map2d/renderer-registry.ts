/**
 * The live 2D renderer, for the two capabilities only it has: capturing the whole map, and
 * reconciling the object layer with state.
 *
 * A registry rather than a prop, for the same reason `active-view.ts` is one: the callers are the
 * export pipeline, the agent's snapshotter and the editor's own operations, none of which sit in
 * the React tree that owns the canvas.
 */
import type { MapRenderer } from './map-renderer';

let renderer: MapRenderer | null = null;

export function setMapRenderer(next: MapRenderer | null): void { renderer = next; }
export function getMapRenderer(): MapRenderer | null { return renderer; }
