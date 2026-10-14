import { useT } from '../../../../i18n/context';
import { useTextReview } from '../../../chrome/modals/export/edition-export';

/** Only committed text enters review; editing retires the card's preview and landing authority. */
export function useStencilReview(open: boolean, text: string | null, editing: boolean) {
  const t = useT();
  const review = useTextReview(open, text ? [{ field: 'stencil', text }] : [], editing);
  const note = review.issue === 'unavailable' ? t('generate.review_unavailable')
    : review.issue === 'too-long' ? t('export.review.too_long')
      : review.issue ? t('generate.review_refused') : null;
  return {
    allowed: review.allowed && !editing,
    pending: review.pending,
    note,
    retry: review.issue === 'unavailable' || review.paused ? review.retry : undefined,
  };
}
