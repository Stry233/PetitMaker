// The text check's door alone, for callers whose bundle must not reach the map check's worker (an edition
// without workers aliases `text/reviewer.ts` for one that runs here); `index.ts` is the door to every check.
export {
  type ReviewProgress, type ReviewResult, type TextPart,
} from './text/policy';
export { ReviewTooLong, ReviewWorkerLease, reviewText } from './text/reviewer';
export { createBackgroundReview } from './text/background-review';
