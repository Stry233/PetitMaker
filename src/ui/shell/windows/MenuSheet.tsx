/*
 * MenuSheet.tsx — what the menu button opens: the five windows, as one sheet of paper.
 *
 * The design draws the sheet as a filled plate with one rule across it, and nothing else: no
 * gradient, no stroke, no effect (see tokens.ts). So it is DRAWN rather than placed as art, which is
 * what lets a row be as wide as its own label: the drawing's plate is 229 design px, measured
 * against the Chinese it was drawn in, and "Настройки клавиатуры" is not that. The sheet takes the
 * width of its widest row and the rule stays where the design puts it, between the second row and
 * the third.
 *
 * Opening is `setModal`, the one home every overlay's open state has, so a keyboard command or an
 * agent tool opens the same window this sheet does.
 */
import { Fragment, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore, type ModalId } from '../../../state/store';
import { ClickCatcher } from '../../primitives/ClickCatcher';
import { btnReset, cursors, springs, z } from '../../design/styles';
import { useReadableWeight } from '../../design/scale';
import { MODE_ROW_BASE } from '../frame';
import { INSET, LINE, PANEL_EDGE, PLATE, PLATE_INK } from '../../design/tokens';
import { EDGE_RIGHT, TEXT } from '../units';

/**
 * A row: a window it opens, or the one thing here that acts on the map instead.
 *
 * CLEAR IS AN ACTION, AND IT IS HERE RATHER THAN IN THE GENERATE SHELF. It is the one destructive
 * thing that bar offered, and it is undo's job by another name, so it does not belong a click away
 * from the candidates it destroys. What it does is unchanged: `kit/operations` bounds it by the last
 * run's own extent and by who authored each cell, so hand-placed work inside that scope survives.
 */
type MenuRow = { labelKey: string; rule?: boolean } & (
  | { modal: ModalId }
  | { run: () => void }
);

/** The rows, top to bottom. `rule` marks the one the design draws its separator above. */
const ROWS: readonly MenuRow[] = [
  { modal: 'newProject', labelKey: 'modal.new_title' },
  { modal: 'import', labelKey: 'import.title' },
  { modal: 'settings', labelKey: 'modal.settings_title', rule: true },
  { modal: 'help', labelKey: 'modal.help_title' },
  { modal: 'about', labelKey: 'modal.about_title' },
];

/** Clear of the top-right cluster, with air between the two so the sheet reads as a thing the
 *  button opened rather than as part of it. Measured from the line that cluster stands on, which is
 *  where the button the sheet belongs to ends. */
const SHEET_TOP = MODE_ROW_BASE + 14;

export interface MenuSheetProps {
  open: boolean;
  onDismiss: () => void;
}

export function MenuSheet({ open, onDismiss }: MenuSheetProps) {
  const t = useT();
  const fw = useReadableWeight();
  const setModal = useEditorStore((s) => s.setModal);

  // Escape closes the sheet. It is not a modal — nothing is locked out behind it — so this is its
  // own listener rather than `ModalShell`'s topmost-shell stack.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onDismiss]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <ClickCatcher onDismiss={onDismiss} zIndex={z.panel} />
          <motion.div
            key="menu-sheet"
            role="menu"
            aria-label={t('a11y.open_menu')}
            initial={{ opacity: 0, scale: 0.9, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -8 }}
            transition={springs.stiff}
            style={{
              position: 'fixed',
              top: SHEET_TOP,
              right: EDGE_RIGHT,
              // The frame's plane is deaf so the map keeps its presses; a surface standing on it
              // claims its own (`shell/Shell.tsx`'s frame style).
              pointerEvents: 'auto',
              minWidth: 176,
              padding: 10,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              background: PLATE,
              border: PANEL_EDGE,
              borderRadius: 20,
              transformOrigin: 'top right',
              // Over the rail, whose top cluster stands on this edge right under the sheet: the
              // sheet is what the button just opened, so it cannot be the thing that is covered.
              // The rung only holds where the sheet is a SIBLING of the column (`Shell.tsx`): the
              // frame's fade is a stacking context, and inside it this number would be scoped to
              // the frame's own.
              zIndex: z.opened,
            }}
          >
            {ROWS.map((row) => (
              <Fragment key={row.labelKey}>
                {row.rule ? (
                  <span style={{ height: 2, background: LINE, margin: '6px 10px', borderRadius: 2 }} />
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    if ('modal' in row) setModal(row.modal, true);
                    else row.run();
                    onDismiss();
                  }}
                  onPointerEnter={(e) => { e.currentTarget.style.background = INSET; }}
                  onPointerLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  style={{
                    ...btnReset,
                    padding: '10px 12px',
                    background: 'transparent',
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    whiteSpace: 'nowrap',
                    fontSize: TEXT.tab,
                    fontWeight: fw(700, TEXT.tab),
                    color: PLATE_INK,
                    cursor: cursors.clickable,
                  }}
                >
                  {t(row.labelKey)}
                </button>
              </Fragment>
            ))}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
