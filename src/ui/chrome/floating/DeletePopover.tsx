import { useEffect, useRef, type ReactElement, type RefObject } from 'react';
import { useChromeScale, useTouchPrimary, useWeightVars } from '../../design/scale';
import { getActiveView } from '../../../view/active-view';
import { AnimatePresence, type MotionStyle } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { getCell } from '../../../core/model/grid-model';
import { deleteObjectConfirmed, peelTerrainAt } from '../../../editor/editing/group-edit';
import { useT, localizedName } from '../../../i18n/context';
import type { FloatingTarget } from '../../primitives/use-floating-position';
import { visualRect } from '../../design/visual-rect';
import { AnchoredConfirm } from '../../primitives/AnchoredConfirm';
import type { Translate } from '../../../i18n/keys';

/** The question a single object's removal asks, with the piece named in the visitor's language. */
export function objectDeleteTitle(t: Translate, name: string): string {
  return t('delete.confirm', { name });
}

/** The confirmation card: the question and its two answers. Every surface that raises this
 *  question mounts this — the live card over the map, and the Help Center's figure of it.
 *  `style` carries the position and the scale the card draws at. `trigger` is the control that
 *  asked, if any: pressing it again closes the card rather than counting as a press outside. */
export function DeleteConfirmFace({ title, onCancel, onConfirm, style, anchor, trigger, prefer, zoom = 1 }: {
  anchor?: FloatingTarget;
  trigger?: RefObject<HTMLElement | null>;
  prefer?: 'above' | 'below';
  zoom?: number;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  style?: MotionStyle;
}) {
  const t = useT();
  return (
    <AnchoredConfirm title={title} cancelLabel={t('delete.cancel')} confirmLabel={t('delete.confirm_btn')}
      onCancel={onCancel} onConfirm={onConfirm} helpTarget={{ page: 'select', anchor: 'select-confirm' }}
      anchor={anchor} trigger={trigger} prefer={prefer} zoom={zoom} style={style} />
  );
}

export function DeletePopover() {
  // A fingertip gets the card at its designed size at least, so its answers stay easy to tap.
  const touch = useTouchPrimary();
  const scale = useChromeScale();
  const chrome = touch ? Math.max(scale, 1) : scale;
  const weights = useWeightVars();
  const t = useT();
  const sel = useEditorStore((s) => s.deletePopover);
  const gridState = useEditorStore((s) => s.gridState);
  const executor = useEditorStore((s) => s.commandExecutor);

  // Viewport movement invalidates the projected anchor and can move the deletion target off screen.
  const eventBus = useEditorStore((s) => s.eventBus);
  useEffect(() => {
    if (!sel) return;
    const close = () => useEditorStore.getState().setDeletePopover(null);
    eventBus.on('viewport-changed', close);
    return () => eventBus.off('viewport-changed', close);
  }, [sel, eventBus]);

  const dismiss = () => useEditorStore.getState().setDeletePopover(null);
  // One stable ref, so the surface scope sees the same trigger across renders.
  const controlRef = useRef<HTMLElement | null>(null);

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
        title = objectDeleteTitle(t, name);
        confirm = () => {
          deleteObjectConfirmed(t, obj.id);
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
          peelTerrainAt(sel.x, sel.y);
          dismiss();
        };
      }
    }

    // When the selection card is on screen the question grows from its delete control, off the
    // card's far edge so it covers neither the card's row nor the thing being deleted.
    const control = document.querySelector<HTMLElement>('[data-selection-delete]');
    const card = control?.closest<HTMLElement>('[data-testid="selection-card"]');
    const shown = !!control && card?.style.visibility === 'visible';
    controlRef.current = shown ? control : null;
    const growUp = card?.dataset.grow === 'up';
    let anchor: FloatingTarget = { x: screenX, y: screenY };
    if (shown && card && control) {
      const button = visualRect(control), plate = visualRect(card.firstElementChild ?? card);
      anchor = { x: button.left + button.width / 2, y: growUp ? plate.top : plate.bottom };
    }
    if (confirm) {
      content = (
        <DeleteConfirmFace
          key="popover"
          title={title}
          onCancel={dismiss}
          onConfirm={confirm}
          anchor={anchor} trigger={shown ? controlRef : undefined} prefer={shown && growUp ? 'above' : 'below'} zoom={chrome}
          style={{ zoom: chrome, ...weights }}
        />
      );
    }
  }

  return <AnimatePresence>{content}</AnimatePresence>;
}
