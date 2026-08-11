import { useEffect, useRef, type CSSProperties, type ReactElement } from 'react';
import { useChromeScale } from '../../design/scale';
import { getActiveView } from '../../../canvas/active-view';
import { motion, AnimatePresence } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { getCell } from '../../../core/model/grid-model';
import { peelTerrain } from '../../../tools/objects/actions';
import { deleteSelection } from '../../../kit/group-edit';
import { useT, localizedName } from '../../../i18n/context';
import { colors, radii, shadows, font, btnBase, springs, pressable, exitTransition, z } from '../../design/styles';

// Visual only — position (left/top), centering (Framer x:'-50%') and the
// enter/exit motion live on the motion.div so Framer owns `transform`.
// maxWidth + wrap: `title` embeds a localized item name (delete.confirm) or a
// longer sentence (ru/th/fr delete.confirm_terrain) that can run well past the
// en/zh baseline length. Without a cap the popover (auto-width, positioned at
// an arbitrary map point) grows into a single unbroken line that can run off
// the viewport edge; capping the width lets it wrap onto a second line instead.
const popoverStyle: CSSProperties = {
  position: 'fixed',
  zIndex: z.contextMenu,
  background: colors.panelCream,
  borderRadius: 16,
  boxShadow: shadows.float,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  maxWidth: 280,
  ...font.body,
  color: colors.textPrimary,
};

const btnRow: CSSProperties = { display: 'flex', gap: 8, justifyContent: 'flex-end' };
const cancelBtn: CSSProperties = { ...btnBase, padding: '6px 16px', borderRadius: radii.pill, fontSize: 13, fontWeight: 800, background: colors.surfaceSecondary, color: colors.frameDark };
const deleteBtn: CSSProperties = { ...btnBase, padding: '6px 16px', borderRadius: radii.pill, fontSize: 13, fontWeight: 800, background: colors.statusError, color: colors.textInverse };

export function DeletePopover() {
  const chrome = useChromeScale();
  const t = useT();
  const sel = useEditorStore((s) => s.deletePopover);
  const gridState = useEditorStore((s) => s.gridState);
  const executor = useEditorStore((s) => s.commandExecutor);
  const confirmRef = useRef<(() => void) | null>(null);

  // Any pan/zoom strands the popover at a stale screen spot while its Enter shortcut
  // still deletes the (possibly off-screen) target — dismiss on viewport movement.
  const eventBus = useEditorStore((s) => s.eventBus);
  useEffect(() => {
    if (!sel) return;
    const close = () => useEditorStore.getState().setDeletePopover(null);
    eventBus.on('viewport-changed', close);
    return () => eventBus.off('viewport-changed', close);
  }, [sel, eventBus]);

  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useEditorStore.getState().setDeletePopover(null);
      else if (e.key === 'Enter') { e.preventDefault(); confirmRef.current?.(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel]);

  const dismiss = () => useEditorStore.getState().setDeletePopover(null);

  // Build the popover content (or null). Returning it through AnimatePresence
  // keeps it mounted to play a close-exit instead of vanishing.
  let content: ReactElement | null = null;
  if (sel && gridState && executor) {
    const proj = getActiveView()?.projection;
    let title = '';
    let confirm: (() => void) | null = null;
    let screenX = 0, screenY = 0;

    if (sel.kind === 'object') {
      const obj = gridState.objects.get(sel.id);
      if (obj) {
        const item = getCatalogItem(obj.catalogId);
        const size = getPlacedObjectSize(obj);
        const locale = useEditorStore.getState().locale;
        if (proj) {
          const pos = proj.cellToScreen(obj.position.x, obj.position.y);
          screenX = pos.x + (size.w * pos.scale) / 2;
          screenY = pos.y - 8;
        }
        const name = item ? localizedName(item.name, locale) : obj.catalogId;
        title = t('delete.confirm').replace('{name}', name);
        confirm = () => {
          // Routed through deleteSelection (one member) rather than removeObject directly, so a
          // locked object reports through the SAME register any other refused delete does.
          deleteSelection(executor, useEditorStore.getState().gridState!, eventBus, t, [obj.id]);
          useEditorStore.getState().clearSelection();
          dismiss();
        };
      }
    } else {
      const cell = getCell(gridState.cells, sel.x, sel.y);
      if (cell?.terrain) {
        if (proj) {
          const pos = proj.cellToScreen(sel.x, sel.y);
          screenX = pos.x + pos.scale / 2;
          screenY = pos.y - 8;
        }
        title = t('delete.confirm_terrain');
        confirm = () => {
          peelTerrain(executor, sel.x, sel.y, cell);
          useEditorStore.getState().clearSelection();
          dismiss();
        };
      }
    }

    if (confirm) {
      confirmRef.current = confirm;
      content = (
        <motion.div
          key="popover"
          initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.85, opacity: 0, transition: exitTransition }}
          transition={springs.bouncy}
          style={{ ...popoverStyle, zoom: chrome, left: screenX / chrome, top: screenY / chrome, x: '-50%' }}
        >
          <span>{title}</span>
          <div style={btnRow}>
            <motion.button {...pressable} style={cancelBtn} onClick={dismiss}>{t('delete.cancel')}</motion.button>
            <motion.button {...pressable} style={deleteBtn} onClick={confirm}>{t('delete.confirm_btn')}</motion.button>
          </div>
        </motion.div>
      );
    }
  }

  return <AnimatePresence>{content}</AnimatePresence>;
}
