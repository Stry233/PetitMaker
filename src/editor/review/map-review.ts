// One check of the live map's pictures by the map review. The window's hook keeps the result per
// map revision and runs at most one check at a time.
import { reviewMap, type MapReview } from '../../pipelines/moderation';
import { throwIfAborted } from '../../platform/async/abort';
import { captureReviewViews } from './map-capture';

export type { MapReview };

/** What a check that could not run reports. */
export const MAP_REVIEW_UNAVAILABLE: MapReview = { status: 'unavailable' };

/** What was checked: the map and the caller's key for the pictures it showed (its revision, notes
 *  and illustration). */
interface MapReviewSubject { map: object; key: string }

/** The latest verdict a check reached, for the subject it was reached on. */
let latest: { subject: MapReviewSubject; verdict: MapReview } | null = null;

/** The verdict the latest check reached on exactly this subject, so a window opened again on a map
 *  that has not changed shows it without capturing and checking the same pictures again. */
export function knownMapReview(subject: MapReviewSubject): MapReview | null {
  return latest && latest.subject.map === subject.map && latest.subject.key === subject.key ? latest.verdict : null;
}

/** Drops the kept verdict, so the next check runs afresh. */
export function forgetMapReview(): void {
  latest = null;
}

/** The map review's verdict on the live map, with its notes and the selected illustration when
 *  asked. A check that fails reads as unavailable and is not kept; an aborted one throws. */
export async function reviewLiveMap(
  views: { illustration: boolean; annotations: boolean }, signal: AbortSignal, subject?: MapReviewSubject,
): Promise<MapReview> {
  try {
    const rasters = await captureReviewViews(views.illustration, views.annotations);
    const verdict = await reviewMap(rasters, signal);
    throwIfAborted(signal);
    if (subject && verdict.status !== 'unavailable') latest = { subject, verdict };
    return verdict;
  } catch (error) {
    if (signal.aborted) throw error;
    return MAP_REVIEW_UNAVAILABLE;
  }
}
