/**
 * A planet's name field under the export text check, with the planet's own refusal copy. A name
 * approved while typed counts as approved wherever the planet goes, and the name the planet
 * already carries needs no check.
 */
import type { RefObject } from 'react';
import { useT } from '../../../../i18n/context';
import { PLANET_NAME_MAX } from '../../../../io/save/facts';
import { recordTextVerdict } from '../../../../state/text-verdicts';
import { ReviewedTextField, useReviewedText, type ReviewedText } from '../export/review/ReviewedTextField';

const approvedName = (name: string) => recordTextVerdict(name, true);

/** The check behind one name field; `known` is the name the planet already carries. */
export function usePlanetNameReview(open: boolean, name: string, known: string) {
  return useReviewedText(open, name, known, 'planet', approvedName);
}

export function PlanetNameField(props: {
  check: ReviewedText;
  inputRef?: RefObject<HTMLInputElement>;
  value: string;
  onChange: (name: string) => void;
  /** Enter with an approved name. */
  onSubmit: () => void;
}) {
  const t = useT();
  return <ReviewedTextField {...props} label={t('planet.name_field')} maxLength={PLANET_NAME_MAX}
    refusedText={t('planet.review_refused')} unavailableText={t('planet.review_unavailable')} />;
}
