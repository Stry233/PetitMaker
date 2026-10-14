// One check of the live map's pictures by the map review. The window's hook keeps the result per
// map revision and runs at most one check at a time.
import { reviewMap, type MapReview } from '../../pipelines/moderation';
import { throwIfAborted } from '../../platform/async/abort';
import { captureReviewViews } from './map-capture';

export type { MapReview };

/** What a check that could not run reports. */
export const MAP_REVIEW_UNAVAILABLE: MapReview = { status: 'unavailable' };

/** The map review's verdict on the live map, with its notes and the selected illustration when
 *  asked. A check that fails reads as unavailable; an aborted one throws. */
export async function reviewLiveMap(views: { illustration: boolean; annotations: boolean }, signal: AbortSignal): Promise<MapReview> {
  try {
    const rasters = await captureReviewViews(views.illustration, views.annotations);
    const verdict = await reviewMap(rasters, signal);
    throwIfAborted(signal);
    return verdict;
  } catch (error) {
    if (signal.aborted) throw error;
    return MAP_REVIEW_UNAVAILABLE;
  }
}
