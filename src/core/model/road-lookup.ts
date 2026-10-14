import type { PlacedObject } from './types';

/** Base pavement lookup injected by the host; silhouettes connect only within the pavement layer. */
export interface RoadLookup {
  (x: number, y: number): PlacedObject | null;
  /** Terrain reconciliation carries every independent coating layer with its supporting ground. */
  coatingsAt?: (x: number, y: number) => readonly PlacedObject[];
}
