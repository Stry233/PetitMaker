/**
 * A short text a person names something with, under the export text check. The text is checked
 * once it stands still and any IME composition has finished, with the export fields' spinner inside
 * the field; a refused or unchecked text gets its owner's feedback under it. A text is approved
 * only for its exact trimmed form, and the text the thing already carries needs no check.
 */
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useT } from '../../../../../i18n/context';
import type { TextField } from '../../../../../pipelines/moderation/facts';
import { reviewedTextParts } from '../../../../../editor/review/text-parts';
import { roleFont } from '../../../../design/text-weight';
import { skin, windowField } from '../../../../design/window-skin';
import { ActionButton } from '../../../../primitives/ActionButton';
import { Expand } from '../../../../primitives/Expand';
import { useTextReview } from '../edition-export';
import { automaticExportReview } from '../../../../../editor/review/edition-review';
import { ReviewIndicator } from './ReviewIndicator';
import { useEffectEvent } from '../../../../primitives/use-effect-event';

/** The check behind one field; `known` is the text the thing already carries. `onApproved`
 *  hears each exact text the check approves while it is typed. */
export function useReviewedText(open: boolean, text: string, known: string, field: TextField, onApproved?: (text: string) => void) {
  const [composing, setComposing] = useState(false);
  const trimmed = text.trim();
  const parts = useMemo(() => reviewedTextParts(trimmed, known, field), [trimmed, known, field]);
  const review = useTextReview(open, parts, composing);
  const approvedText = review.allowed && parts.length ? parts[0]!.text : null;
  const approve = useEffectEvent((approved: string) => onApproved?.(approved));
  useEffect(() => { if (approvedText !== null) approve(approvedText); }, [approvedText]);
  // An edition without the automatic check lets text through as it lets export text through.
  const approved = !!trimmed && !composing && (!automaticExportReview || review.allowed);
  return { approved, composing, setComposing, review };
}

export type ReviewedText = ReturnType<typeof useReviewedText>;

export function ReviewedTextField({ check, inputRef, value, onChange, onSubmit, label, maxLength, refusedText, unavailableText }: {
  check: ReviewedText;
  inputRef?: RefObject<HTMLInputElement>;
  value: string;
  onChange: (text: string) => void;
  /** Enter with an approved text. */
  onSubmit: () => void;
  /** The field's accessible name. */
  label: string;
  maxLength: number;
  refusedText: string;
  unavailableText: string;
}) {
  const t = useT();
  const { issue, pending, paused, retry } = check.review;
  const refused = issue !== null && typeof issue === 'object';
  const message = issue === 'unavailable' ? unavailableText
    : issue === 'too-long' ? t('export.review.too_long')
      : refused ? refusedText : '';
  const offerRetry = issue === 'unavailable' || (paused && !check.composing);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ position: 'relative' }}
        onCompositionStartCapture={() => check.setComposing(true)} onCompositionEndCapture={() => check.setComposing(false)}>
        <input ref={inputRef} value={value} maxLength={maxLength} aria-label={label}
          aria-busy={pending} aria-invalid={refused}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (check.approved && e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) onSubmit(); }}
          style={{ ...windowField, paddingRight: 32 }} />
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
