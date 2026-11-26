import type { RefObject } from 'react';
import { CUSTOM_TAG_TEXT_MAX } from '../../../../core/model/annotations';
import { recordTextVerdict } from '../../../../state/text-verdicts';
import { useT } from '../../../../i18n/context';
import { NameCard } from '../NameCard';
import { useRunCommand } from '../../use-shell-commands';

/** The card the add pill unrolls: a tag name under the text check. Only an approved name joins the
 *  row; a name the row already shows arms that tag instead. */
export default function NewTagCard({ anchor, onClose }: { anchor: RefObject<HTMLElement | null>; onClose: () => void }) {
  const t = useT();
  const run = useRunCommand();
  return (
    // The tag row stands at the foot of the window, so the card opens above it, where its tallest state fits.
    <NameCard anchor={anchor} prefer="above" helpTarget={{ page: 'notes' }} title={t('annot.tag_add_title')}
      confirmLabel={t('annot.tag_add_confirm')} label={t('annot.tag_name')} field="tag" maxLength={CUSTOM_TAG_TEXT_MAX}
      refusedText={t('annot.tag_refused')} unavailableText={t('annot.tag_unavailable')} onApproved={approvedTag}
      onCancel={onClose} onConfirm={(name) => { run('notes.tag_add', { name }); onClose(); }} />
  );
}

/** A tag name approved while typed is approved wherever the map goes this session. */
const approvedTag = (text: string) => recordTextVerdict(text, true);
