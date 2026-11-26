/*
 * What the menu button opens: the windows, as one menu card hung from the button at the frame's own
 * zoom. Opening a row is the `window.open` command, so every caller opens the same window.
 */
import type { RefObject } from 'react';
import { useT } from '../../../i18n/context';
import type { ModalId } from '../../../state/store';
import type { FramePose } from '../../../state/frame-pose';
import { sessionOpens } from '../../../state/session-offer';
import { useFramePose } from '../../session/use-frame-pose';
import { helpTargetAttr } from '../../session/help-targets';
import type { HelpPageId } from '../../../editor/help/page-schema';
import { FloatMenu, type FloatMenuItem } from '../../primitives/FloatMenu';
import type { I18nKey } from '../../../i18n/keys';
import { forEdition } from '../../../platform/build/edition';
import { useRunCommand } from '../use-shell-commands';

/** The Help Center page each row that opens a taught window points at. */
const ROW_HELP: Partial<Record<ModalId, HelpPageId>> = {
  newProject: 'planet',
  import: 'save',
  settings: 'settings',
};

/** A row: the window it opens. `rule` draws the separator above it. */
type MenuRow = { modal: ModalId; labelKey: I18nKey; rule?: boolean };

const ROWS: readonly MenuRow[] = forEdition<MenuRow>([
  { modal: 'newProject', labelKey: 'modal.new_title' },
  // The Import window reads map pictures in every build that has it.
  { modal: 'import', labelKey: 'import.title', needs: 'pictureImport' },
  { modal: 'settings', labelKey: 'modal.settings_title', rule: true },
  { modal: 'help', labelKey: 'modal.help_title' },
  { modal: 'about', labelKey: 'modal.about_title' },
]);

/** The rows the menu offers in `pose`: the windows a session opens (`state/session-offer.ts`). */
function menuRows(pose: FramePose): readonly MenuRow[] {
  return ROWS.filter((row) => sessionOpens(pose, row.modal));
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
  const run = useRunCommand();
  const rows = menuRows(useFramePose());
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
      onPick={(id) => run('window.open', { window: id })}
      aria-label={t('a11y.open_menu')}
      trigger={{ ref: trigger, align: 'end', gap: SHEET_GAP, minWidth: SHEET_MIN_W, onMap: true }}
    />
  );
}
