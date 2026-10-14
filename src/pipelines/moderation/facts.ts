// The content checks' light facts, for callers that must not pull the pipeline's workers into their
// bundle (the eager one, or an edition without the checks): the text-review vocabulary and which
// text needs a check. The map check's files are `map-facts.ts`, since naming them emits the assets.
export {
  needsTextReview, type ReviewProgress, type ReviewResult, type TextField, type TextPart,
} from './text/policy';
