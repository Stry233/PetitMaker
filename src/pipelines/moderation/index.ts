// The content checks' door: callers outside the pipeline import from here or from `facts.ts`. Each
// check runs in its own lazily started worker, so nothing here loads a matcher or a model.
export {
  needsTextReview, type ReviewProgress, type ReviewResult, type TextField, type TextPart,
} from './text/policy';
export { ReviewTooLong, ReviewWorkerLease, reviewText } from './text/reviewer';
export { reviewLongText } from './text/review-windows';
export { createBackgroundReview } from './text/background-review';
export { reviewMap, type MapRaster, type MapReview } from './map/reviewer';
