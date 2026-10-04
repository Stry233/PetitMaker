import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { ConfirmationModal } from '../../primitives/ConfirmationModal';

export function AnnotationDiscardModal() {
  const t = useT();
  const open = useEditorStore(s => s.annotationDiscardAction !== null);
  const cancel = useEditorStore(s => s.cancelAnnotationDiscard);
  const discard = useEditorStore(s => s.confirmAnnotationDiscard);
  const save = useEditorStore(s => s.confirmAnnotationSave);
  return (
    <ConfirmationModal open={open} helpTarget={{ page: 'notes', anchor: 'notes-edit' }}
      title={t('annot.discard_title')} message={t('annot.discard_message')}
      cancelLabel={t('delete.cancel')} confirmLabel={t('annot.save')}
      alternativeAction={{ label: t('annot.discard'), onClick: discard }}
      onCancel={cancel} onConfirm={save} />
  );
}
