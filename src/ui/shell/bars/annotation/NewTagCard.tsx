import { useEffect, useRef, useState, type RefObject } from 'react';
import { useIsPresent } from 'framer-motion';
import { type CustomTag } from '../../../../core/model/annotations';
import { recordTextVerdict } from '../../../../state/text-verdicts';
import { addOrArmTag } from '../../../../editor/editing/annotation-edit';
import { useT } from '../../../../i18n/context';
import { PLANET_NAME_MAX } from '../../../../io/save/facts';
import { PlanetConfirm } from '../../../chrome/modals/planet/PlanetConfirm';
import { ReviewedTextField, useReviewedText } from '../../../chrome/modals/export/review/ReviewedTextField';

/** The card the add pill unrolls: a tag name under the text check. Only an approved name joins the
 *  row; a name the row already shows arms that tag instead. */
export default function NewTagCard({ anchor, custom, onClose }: { anchor: RefObject<HTMLElement | null>; custom: readonly CustomTag[]; onClose: () => void }) {
  const t = useT();
  const present = useIsPresent();
  const [text, setText] = useState('');
  const fieldRef = useRef<HTMLInputElement>(null);
  const check = useReviewedText(present, text, '', 'tag', approvedTag);
  // After the card's own initial focus, so typing lands in the field.
  useEffect(() => { fieldRef.current?.focus(); }, []);
  const add = () => {
    if (!check.approved) return;
    addOrArmTag(text.trim(), t, custom);
    onClose();
  };
  return (
    // The tag row stands at the foot of the window, so the card opens above it, where its tallest
    // state fits, and stays there while the check's feedback lengthens it.
    <PlanetConfirm anchor={anchor} prefer="above" lockSide helpTarget={{ page: 'notes' }} title={t('annot.tag_add_title')} cancelLabel={t('delete.cancel')}
      confirmLabel={t('annot.tag_add_confirm')} confirmDisabled={!check.approved} onCancel={onClose} onConfirm={add}
      body={<ReviewedTextField check={check} inputRef={fieldRef} value={text} onChange={setText} onSubmit={add}
        label={t('annot.tag_name')} maxLength={PLANET_NAME_MAX}
        refusedText={t('annot.tag_refused')} unavailableText={t('annot.tag_unavailable')} />} />
  );
}

/** A tag name approved while typed is approved wherever the map goes this session. */
const approvedTag = (text: string) => recordTextVerdict(text, true);
