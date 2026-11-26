// The Lite edition's text-review and export policy. Text a player types, and text that arrives from outside,
// passes the review the web edition runs, here on this thread (`pipelines/moderation/text/reviewer-lite.ts`),
// then the host's own check where its container has one. The map is not checked automatically, since its
// check needs a worker the package refuses, and a preset also sets the presentation choices the Lite card is
// drawn with.
import type * as Web from './edition-review';
import type { ExportOptions, ExportPreset } from '../../io/export/types';
import { ReviewTooLong } from '../../pipelines/moderation/text-check';

export { reviewBlueprintText, reviewCustomTags, reviewGroupText, reviewPlanetNames } from './background';

export const automaticExportReview: typeof Web.automaticExportReview = false;
export const liveMapCheck: typeof Web.liveMapCheck = null;
export const automaticTextReview: typeof Web.automaticTextReview = true;
export const textReviewAtCommit: typeof Web.textReviewAtCommit = false;
export const isReviewTooLong: typeof Web.isReviewTooLong = (error) => error instanceof ReviewTooLong;

export const exportPresetDescriptions: typeof Web.exportPresetDescriptions = { share: 'lite.preset_share_desc', plain: 'lite.preset_plain_desc' };

export const applyExportPreset: typeof Web.applyExportPreset = (options: ExportOptions, preset: ExportPreset): ExportOptions => {
  const share = preset === 'share';
  return { ...options, preset, layerPreview: share, grid: share, footer: share, card3d: false };
};
