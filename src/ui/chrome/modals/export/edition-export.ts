export { useMapReview } from './review/use-map-review';
export { useTextReview } from './review/use-text-review';
export { StylizeEntry } from './stylize/StylizeEntry';
import { ReviewTooLong } from '../../../../io/moderation/text/reviewer';

export const automaticExportReview = true;
export const isReviewTooLong = (error: unknown): boolean => error instanceof ReviewTooLong;

export { applyPreset as applyExportPreset } from '../../../../io/export/types';
export const exportPresetDescriptions = { share: 'export.preset_share_desc', plain: 'export.preset_plain_desc' } as const;
