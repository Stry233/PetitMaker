// The web edition's text-review and export policy: outside text is checked in the background,
// exports are reviewed automatically and a preset changes only importability. The Lite build
// replaces this module (`scripts/edition-build.mts`).
import { ReviewTooLong } from '../../pipelines/moderation';
export { applyPreset as applyExportPreset } from '../../io/export/types';

export { reviewCustomTags, reviewPlanetNames } from './background';

export const automaticExportReview: boolean = true;
export const isReviewTooLong = (error: unknown): boolean => error instanceof ReviewTooLong;
