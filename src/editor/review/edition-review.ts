// The web edition's text-review and export policy: outside text is checked in the background,
// exports are reviewed automatically and a preset changes only importability. The Lite build
// replaces this module (`scripts/edition-build.mts`).
import { ReviewTooLong } from '../../pipelines/moderation/text-check';
import { forgetMapReview, knownMapReview, reviewLiveMap } from './map-review';
import type { ExportPreset } from '../../io/export/types';
import type { I18nKey } from '../../i18n/keys';
export { applyPreset as applyExportPreset } from '../../io/export/types';

export { reviewBlueprintText, reviewCustomTags, reviewGroupText, reviewPlanetNames } from './background';

/** What each preset makes of the picture in this edition, as the line under the preset's tabs says it. */
export const exportPresetDescriptions: Readonly<Record<ExportPreset, I18nKey>> = { share: 'export.preset_share_desc', plain: 'export.preset_plain_desc' };

/** Whether a picture's map is checked automatically before it goes out. */
export const automaticExportReview: boolean = true;
/** The check of the live map a picture passes and the verdict it keeps (`map-review.ts`); null where
 *  no map is checked automatically, so that edition never loads the check. */
export const liveMapCheck: { review: typeof reviewLiveMap; known: typeof knownMapReview; forget: typeof forgetMapReview } | null
  = { review: reviewLiveMap, known: knownMapReview, forget: forgetMapReview };
/** Whether typed text is checked automatically before it shows or goes out; without it the export notice's manual review covers it. */
export const automaticTextReview: boolean = true;
/** Whether a typed text is checked only once committed (a press of Save, Add or Export), never as it stands still while typed. */
export const textReviewAtCommit: boolean = false;
export const isReviewTooLong = (error: unknown): boolean => error instanceof ReviewTooLong;
