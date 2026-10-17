/** Export first, the alternative at the start of a window's footer that keeps a copy of a map before
 *  the window's action replaces or repairs it. */
import { useT } from '../../../i18n/context';
import { ActionButton } from '../../primitives/ActionButton';
import { ExportFileIcon } from '../../primitives/line-glyphs';

const style = { display: 'inline-flex', alignItems: 'center', gap: 6 } as const;

export function ExportFirstButton({ onPress, testId }: { onPress: () => void; testId: string }) {
  const t = useT();
  return (
    <ActionButton appearance="secondary" data-testid={testId} onClick={onPress} style={style}>
      <ExportFileIcon />{t('modal.new_export_first')}
    </ActionButton>
  );
}
