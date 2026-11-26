/**
 * A short text a person names something with, under the export text check. The text is checked
 * once it stands still and any IME composition has finished, with the export fields' spinner inside
 * the field; a refused or unchecked text gets its owner's feedback under it. A text is approved
 * only for its exact trimmed form, and the text the thing already carries needs no check.
 */
import { useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react';
import { useT } from '../../../../../i18n/context';
import type { TextField as CheckedField } from '../../../../../pipelines/moderation/facts';
import { createReviewedTextSession, type ReviewedTextInput } from '../../../../../editor/review/text-session';
import { roleFont } from '../../../../design/text-weight';
import { skin } from '../../../../design/window-skin';
import { TextField } from '../../../../primitives/TextField';
import { ActionButton } from '../../../../primitives/ActionButton';
import { Expand } from '../../../../primitives/Expand';
import { ReviewSlot } from './ReviewIndicator';
import { useEffectEvent } from '../../../../primitives/use-effect-event';

/** The check behind one field (`editor/review/text-session.ts:createReviewedTextSession`); `known` is
 *  the text the thing already carries. `onApproved` hears each exact text the check approves while it is typed. */
export function useReviewedText(open: boolean, text: string, known: string, field: CheckedField, onApproved?: (text: string) => void) {
  const [composing, setComposing] = useState(false);
  const [session] = useState(createReviewedTextSession);
  const input: ReviewedTextInput = { open, text, known, field, composing };
  const { approved, approvedText, review } = useSyncExternalStore(session.subscribe, () => session.snapshot(input));
  useLayoutEffect(() => { session.watch(input); });
  useEffect(() => () => session.release(), [session]);
  const approve = useEffectEvent((approvedNow: string) => onApproved?.(approvedNow));
  useEffect(() => { if (approvedText !== null) approve(approvedText); }, [approvedText]);
  return { approved, composing, setComposing, review, retry: session.retry, commit: session.commit };
}

export type ReviewedText = ReturnType<typeof useReviewedText>;

export function ReviewedTextField({
  check, inputRef, value, onChange, onSubmit, label, maxLength, refusedText, unavailableText, placeholder, disabled = false, readOnly = false, height, trailing,
}: {
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
  placeholder?: string;
  /** Greys the field and takes no typing, as a choice beside it that sets the text aside does. */
  disabled?: boolean;
  /** Shows a text the player cannot type, as one the platform gives. */
  readOnly?: boolean;
  /** The field box's height in css px; one line's own height where absent. */
  height?: number;
  /** A control standing inside the field at its right end, which stays live while the text is greyed. */
  trailing?: ReactNode;
}) {
  const t = useT();
  const { issue, pending, paused } = check.review;
  const refused = issue !== null && typeof issue === 'object';
  const message = issue === 'unavailable' ? unavailableText
    : issue === 'too-long' ? t('export.review.too_long')
      : refused ? refusedText : '';
  const offerRetry = issue === 'unavailable' || (paused && !check.composing);
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <TextField inputRef={inputRef} value={value} onChange={readOnly ? () => {} : onChange} readOnly={readOnly} label={label}
        maxLength={maxLength} placeholder={placeholder} disabled={disabled} aria-busy={pending} aria-invalid={refused} height={height}
        onEnter={() => { if (check.approved) onSubmit(); }} onComposingChange={check.setComposing}
        trailing={<><ReviewSlot label={t('export.review.checking')} checking={pending && !disabled} />{trailing}</>} />
      <Expand open={!disabled && (!!issue || offerRetry)}>
        <div role={issue ? 'alert' : undefined} style={{ paddingTop: 8, color: skin.ink, ...roleFont('note'), lineHeight: 1.5 }}>
          {message}
          {offerRetry && (
            <ActionButton appearance="secondary" style={{ marginTop: 8, width: '100%' }} onClick={check.retry}>{t('export.review.retry')}</ActionButton>
          )}
        </div>
      </Expand>
    </div>
  );
}
