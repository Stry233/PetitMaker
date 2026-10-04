/**
 * A planet's name field under the export text check. The name is checked once it stands still and
 * any IME composition has finished, with the export fields' spinner inside the field; a refused or
 * unchecked name gets the export window's feedback under it. A name is approved only for its exact
 * text, and the name the planet already carries needs no check.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useT } from '../../../../i18n/context';
import { needsTextReview, type TextPart } from '../../../../io/moderation/text/policy';
import { PLANET_NAME_MAX } from '../../../../io/planet-codec';
import { recordPlanetNameVerdict } from '../../../../io/planet-library';
import { roleFont } from '../../../design/text-weight';
import { skin, windowField } from '../../../design/window-skin';
import { ActionButton } from '../../../primitives/ActionButton';
import { Expand } from '../../../primitives/Expand';
import { automaticExportReview, useTextReview } from '../export/edition-export';
import { ReviewIndicator } from '../export/review/ReviewIndicator';

/** The check behind one name field; `known` is the name the planet already carries. */
export function usePlanetNameReview(open: boolean, name: string, known: string) {
  const [composing, setComposing] = useState(false);
  const trimmed = name.trim();
  const parts = useMemo<TextPart[]>(
    () => (trimmed !== known.trim() && needsTextReview(trimmed) ? [{ field: 'planet', text: trimmed }] : []),
    [trimmed, known],
  );
  const review = useTextReview(open, parts, composing);
  // A name approved while typed counts as approved wherever the planet goes.
  const approvedText = review.allowed && parts.length ? parts[0]!.text : null;
  useEffect(() => { if (approvedText !== null) recordPlanetNameVerdict(approvedText, true); }, [approvedText]);
  // An edition without the automatic check lets names through as it lets export text through.
  const approved = !!trimmed && !composing && (!automaticExportReview || review.allowed);
  return { approved, composing, setComposing, review };
}

type PlanetNameReview = ReturnType<typeof usePlanetNameReview>;

export function PlanetNameField({ check, inputRef, value, onChange, onSubmit }: {
  check: PlanetNameReview;
  inputRef?: RefObject<HTMLInputElement>;
  value: string;
  onChange: (name: string) => void;
  /** Enter with an approved name. */
  onSubmit: () => void;
}) {
  const t = useT();
  const { issue, pending, paused, retry } = check.review;
  const refused = issue !== null && typeof issue === 'object';
  const message = issue === 'unavailable' ? t('planet.review_unavailable')
    : issue === 'too-long' ? t('export.review.too_long')
      : refused ? t('planet.review_refused') : '';
  const offerRetry = issue === 'unavailable' || (paused && !check.composing);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative' }}
        onCompositionStartCapture={() => check.setComposing(true)} onCompositionEndCapture={() => check.setComposing(false)}>
        <input ref={inputRef} value={value} maxLength={PLANET_NAME_MAX} aria-label={t('planet.name_field')}
          aria-busy={pending} aria-invalid={refused}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (check.approved && e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) onSubmit(); }}
          style={{ ...windowField, paddingRight: 34 }} />
        {pending && <ReviewIndicator label={t('export.review.checking')} />}
      </div>
      <Expand open={!!issue || offerRetry}>
        <div role={issue ? 'alert' : undefined} style={{ paddingTop: 8, color: skin.ink, ...roleFont('caption'), lineHeight: 1.5 }}>
          {message}
          {offerRetry && (
            <ActionButton appearance="secondary" style={{ marginTop: 8, width: '100%' }} onClick={retry}>{t('export.review.retry')}</ActionButton>
          )}
        </div>
      </Expand>
    </div>
  );
}
