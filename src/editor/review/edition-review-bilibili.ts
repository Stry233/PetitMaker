// The Bilibili Toy build's text-review and export policy (`edition-review.ts`), which its build aliases in
// place of the Lite one: Lite's, except that typed text is checked once committed, since the Toy SDK's check,
// which follows the review on this thread (`pipelines/moderation/text/reviewer-lite.ts`), is rate-limited.
import type * as Web from './edition-review';

export {
  applyExportPreset, automaticExportReview, automaticTextReview, exportPresetDescriptions, isReviewTooLong, liveMapCheck,
  reviewBlueprintText, reviewCustomTags, reviewGroupText, reviewPlanetNames,
} from './edition-review-lite';

export const textReviewAtCommit: typeof Web.textReviewAtCommit = true;
