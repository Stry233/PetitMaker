// The content checks' door: callers outside the pipeline import from here, from `text-check.ts` or from
// `facts.ts`. Each check runs in its own lazily started worker, so nothing here loads a matcher or a model.
export { type TextField, type TextPart } from './text/policy';
export { ReviewTooLong, ReviewWorkerLease, reviewText } from './text/reviewer';
export { reviewLongText } from './text/review-windows';
export { reviewMap, type MapRaster, type MapReview } from './map/reviewer';
