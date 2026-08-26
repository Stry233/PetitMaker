import type { PlacedObject } from './types';

/**
 * The paved-cell question, asked rather than fetched.
 *
 * Road silhouette geometry needs to know which cells carry a coating, but the
 * answer lives in `state/object-index`, which `core` may not import — a cell
 * is paved when its object's catalog entry carries `surfaceCoating`, and the
 * catalog is above `core`. So the answer is injected, like `RuleDispatcher`.
 *
 * Returns the coating object itself, not a boolean: callers need its `corners`
 * and `rotation` to derive a connection side.
 */
export type RoadLookup = (x: number, y: number) => PlacedObject | null;

/** An item's chunk-load cost, asked the same way: the road-follow pass re-places a road it moved,
 *  and the PlaceObject command carries the load the chunk-load rule accounts with. */
export type LoadValueLookup = (catalogId: string) => number;
