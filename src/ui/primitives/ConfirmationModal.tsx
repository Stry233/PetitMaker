import { ConfirmationContent, confirmationCardStyle, type ConfirmationContentProps } from './ConfirmationContent';
import { ModalShell, type ModalShellProps } from './ModalShell';

export function ConfirmationModal({ open, helpTarget, ...content }: ConfirmationContentProps & {
  open: boolean;
  helpTarget?: ModalShellProps['helpTarget'];
}) {
  return (
    <ModalShell open={open} onClose={() => { if (!content.busy) content.onCancel(); }}
      width={420} maxVw={94} maxVh={90} helpTarget={helpTarget}
      ariaLabel={content.title} cardStyle={confirmationCardStyle}>
      <ConfirmationContent {...content} />
    </ModalShell>
  );
}
