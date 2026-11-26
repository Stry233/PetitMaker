/**
 * The card a bar unrolls to ask for a name under the text check, in the planets' anchored grammar:
 * Notes' new tag and Blueprint's new folder and renames. Mount it under `AnimatePresence`.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useIsPresent } from 'framer-motion';
import { useT } from '../../../i18n/context';
import type { TextField } from '../../../pipelines/moderation/facts';
import { ControlConfirm } from '../../primitives/ControlConfirm';
import { ReviewedTextField, useReviewedText } from '../../chrome/modals/export/review/ReviewedTextField';
import type { HelpTarget } from '../../primitives/help-target';
import { roleFont } from '../../design/text-weight';
import { skin } from '../../design/window-skin';
import { Expand } from '../../primitives/Expand';

export interface NameCardProps {
  anchor: RefObject<HTMLElement | null>;
  /** The side of the anchor it opens on; it keeps that side while the check's feedback lengthens it. */
  prefer?: 'above' | 'below';
  helpTarget: HelpTarget;
  title: string;
  confirmLabel: string;
  /** The field's accessible name. */
  label: string;
  field: TextField;
  maxLength: number;
  known?: string;
  refusedText: string;
  unavailableText: string;
  problem?: (name: string) => string | null;
  /** Hears each text the check approves while it is typed. */
  onApproved?: (text: string) => void;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}

/** `known` is the text the thing already carries, which needs no check and confirms nothing;
 *  `problem` says why a trimmed name cannot be taken, which keeps Confirm greyed. */
export function NameCard({
  anchor, prefer = 'above', helpTarget, title, confirmLabel, label, field, maxLength, known = '', refusedText, unavailableText,
  problem, onApproved, onCancel, onConfirm,
}: NameCardProps) {
  const t = useT();
  const present = useIsPresent();
  const [text, setText] = useState(known);
  const fieldRef = useRef<HTMLInputElement>(null);
  const check = useReviewedText(present, text, known, field, onApproved);
  // After the card's own initial focus, so the name is what the keyboard lands on.
  useEffect(() => { fieldRef.current?.focus(); fieldRef.current?.select(); }, []);
  const changed = text.trim() !== known;
  const said = problem?.(text.trim()) ?? null;
  const ready = check.approved && changed && said === null;
  const confirm = () => { if (ready) check.commit(() => onConfirm(text.trim())); };
  return (
    <ControlConfirm anchor={anchor} prefer={prefer} lockSide helpTarget={helpTarget} title={title}
      cancelLabel={t('delete.cancel')} confirmLabel={confirmLabel} confirmDisabled={!ready}
      onCancel={onCancel} onConfirm={confirm}
      body={(
        <>
          <ReviewedTextField check={check} inputRef={fieldRef} value={text} onChange={setText} onSubmit={confirm}
            label={label} maxLength={maxLength} refusedText={refusedText} unavailableText={unavailableText} />
          {problem && (
            <Expand open={said !== null}>
              <div role="alert" style={{ paddingTop: 8, color: skin.ink, ...roleFont('note'), lineHeight: 1.5 }}>{said}</div>
            </Expand>
          )}
        </>
      )} />
  );
}
