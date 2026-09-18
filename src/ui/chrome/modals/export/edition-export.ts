export { useMapReview } from './review/use-map-review';
export { useTextReview } from './review/use-text-review';
export { StylizeEntry } from './stylize/StylizeEntry';
import { ReviewTooLong } from '../../../../io/moderation/text/reviewer';

export const automaticExportReview = true;
export const isReviewTooLong = (error: unknown): boolean => error instanceof ReviewTooLong;
