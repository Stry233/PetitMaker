/**
 * The card a file of another window's kind gets in place of an import: it says what the file is
 * and offers that window, which opens with the file already handed to it.
 */
import { useT } from '../../../../i18n/context';
import type { HandedImport } from '../../../../state/slices/shell';
import { useEditorStore } from '../../../../state/store';
import { ConfirmationContent, type ConfirmationContentProps } from '../../../primitives/ConfirmationContent';

export interface ImportRedirectProps {
  /** The file as the import surfaces classified it, and where it belongs. */
  hand: HandedImport;
  /** Called once the file is handed on, before the windows change. */
  onGone?: () => void;
  onCancel: () => void;
}

/** The confirmation that hands `hand` to the window reading its kind. */
export function useRedirectContent({ hand, onGone, onCancel }: ImportRedirectProps): ConfirmationContentProps {
  const t = useT();
  const target = t(hand.kind === 'map' ? 'import.title' : 'planet.import');
  const go = () => {
    onGone?.();
    useEditorStore.getState().handImport(hand);
  };
  const copy = hand.kind === 'map'
    ? { title: t('planet.redirect_map_title'), message: t('planet.redirect_map_body', { window: target }) }
    : hand.kind === 'planet'
      ? { title: t('import.redirect_planet_title'), message: t('import.redirect_planet_body', { window: target, mine: t('planet.mine_group') }) }
      : { title: t('import.redirect_video_title'), message: t('import.redirect_video_body', { window: target }) };
  return { ...copy, confirmLabel: t('import.redirect_go', { window: target }), cancelLabel: t('delete.cancel'), onCancel, onConfirm: go };
}

export function ImportRedirect(props: ImportRedirectProps) {
  const content = useRedirectContent(props);
  return (
    <div data-testid="import-redirect" data-kind={props.hand.kind}>
      <ConfirmationContent {...content} />
    </div>
  );
}
