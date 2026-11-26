import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { ConfirmationModal } from '../../primitives/ConfirmationModal';
import { pressCommand } from '../../../editor/commands/run';

const answer = (given: 'save' | 'discard' | 'cancel'): void => pressCommand('notes.discard_answer', { answer: given });

export function AnnotationDiscardModal() {
  const t = useT();
  const open = useEditorStore(s => s.annotationDiscardAction !== null);
  return (
    <ConfirmationModal open={open} helpTarget={{ page: 'notes', anchor: 'notes-edit' }}
      title={t('annot.discard_title')} message={t('annot.discard_message')}
      cancelLabel={t('delete.cancel')} confirmLabel={t('annot.save')}
      alternativeAction={{ label: t('annot.discard'), onClick: () => answer('discard') }}
      onCancel={() => answer('cancel')} onConfirm={() => answer('save')} />
  );
}
