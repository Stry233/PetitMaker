/*
 * What the menu button opens: the windows, as one menu card hung from the button at the frame's own
 * zoom. Opening a row is `setModal`, so a keyboard command or an agent tool opens the same window.
 */
import type { RefObject } from 'react';
import { useT } from '../../../i18n/context';
import { useEditorStore, type ModalId } from '../../../state/store';
import { helpTargetAttr } from '../../session/help-targets';
import type { HelpPageId } from '../../help/page-schema';
import { FloatMenu, type FloatMenuItem } from '../../primitives/FloatMenu';
import { useFrameZoom } from '../use-frame-zoom';
import type { I18nKey } from '../../../i18n/keys';

/** The Help Center page each row that opens a taught window points at. */
const ROW_HELP: Partial<Record<ModalId, HelpPageId>> = {
  newProject: 'planet',
  import: 'save',
  settings: 'settings',
};

/** A row: the window it opens. `rule` draws the separator above it; `mapOnly` rows act on the map,
 *  which a planet session has none of. */
type MenuRow = { modal: ModalId; labelKey: I18nKey; rule?: boolean; mapOnly?: boolean };

const ROWS: readonly MenuRow[] = [
  { modal: 'newProject', labelKey: 'modal.new_title', mapOnly: true },
  { modal: 'import', labelKey: 'import.title', mapOnly: true },
  { modal: 'settings', labelKey: 'modal.settings_title', rule: true },
  { modal: 'help', labelKey: 'modal.help_title' },
  { modal: 'about', labelKey: 'modal.about_title' },
];

/** The rows the menu offers over a map, or inside a planet session. */
function menuRows(inSession: boolean): readonly MenuRow[] {
  return inSession ? ROWS.filter((row) => !row.mapOnly) : ROWS;
}

/** The card's least width, so a short language still reads as a sheet rather than a tag. */
const SHEET_MIN_W = 176;
/** Air between the menu button's ink and the card. */
const SHEET_GAP = 14;

export function MenuSheet({ open, onDismiss, trigger }: {
  open: boolean;
  onDismiss: () => void;
  /** The menu button the card hangs from. */
  trigger: RefObject<HTMLElement>;
}) {
  const t = useT();
  const zoom = useFrameZoom();
  const setModal = useEditorStore((s) => s.setModal);
  const rows = menuRows(useEditorStore((s) => s.planetSession !== null));
  const items: FloatMenuItem[] = rows.map((row, i) => ({
    id: row.modal,
    label: t(row.labelKey),
    separated: !!row.rule && i > 0,
    ...(ROW_HELP[row.modal] ? { attrs: helpTargetAttr(ROW_HELP[row.modal]!) as Record<string, string> } : {}),
  }));
  return (
    <FloatMenu
      row={null}
      items={items}
      open={open}
      onOpen={() => {}}
      onClose={onDismiss}
      onPick={(id) => setModal(id as ModalId, true)}
      zoom={zoom}
      aria-label={t('a11y.open_menu')}
      trigger={{ ref: trigger, align: 'end', gap: SHEET_GAP, minWidth: SHEET_MIN_W, onMap: true }}
    />
  );
}
