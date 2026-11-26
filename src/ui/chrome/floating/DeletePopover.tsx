import { useEffect, useMemo, useReducer, useRef, type ReactElement, type RefObject } from 'react';
import { TOUCH_TARGET } from '../../design/scale';
import { ChromeLifted } from '../../primitives/ChromeLifted';
import { getActiveView, onProjectionChange } from '../../../view/active-view';
import { AnimatePresence, type MotionStyle } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { getCatalogItem } from '../../../state/catalog';
import { getPlacedObjectSize } from '../../../state/object-geometry';
import { getCell } from '../../../core/model/grid-model';
import { deleteObjectConfirmed, peelTerrainAt } from '../../../editor/editing/group-edit';
import { useT, localizedName } from '../../../i18n/context';
import type { FloatingTarget } from '../../primitives/use-floating-position';
import { visualRect } from '../../design/visual-rect';
import { projectedBox } from './projected-box';
import { AnchoredConfirm } from '../../primitives/AnchoredConfirm';
import { DELETE_QUESTION_ENTRY } from '../../../editor/back/back-out';
import type { Translate } from '../../../i18n/keys';
import { useCardAnchor, type CardAnchor } from './selection-card-anchor';

/** The question a single object's removal asks, with the piece named in the visitor's language. */
export function objectDeleteTitle(t: Translate, name: string): string {
  return t('delete.confirm', { name });
}

/** The confirmation card: the question and its two answers. Every surface that raises this
 *  question mounts this — the live card over the map, and the Help Center's figure of it.
 *  `style` carries the position and the scale the card draws at. `trigger` is the control that
 *  asked, if any: pressing it again closes the card rather than counting as a press outside. */
export function DeleteConfirmFace({ title, onCancel, onConfirm, style, anchor, trigger, prefer, zoom = 1, backId }: {
  anchor?: FloatingTarget;
  backId?: string;
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
      anchor={anchor} trigger={trigger} prefer={prefer} zoom={zoom} style={style} backId={backId} />
  );
}

/** The live card's delete control and plate where the card shows, read as the question is placed. */
function shownCard(card: CardAnchor | null): { control: HTMLElement; plate: HTMLElement } | null {
  const control = card?.control.current, plate = card?.plate.current;
  return control && plate && card.box.current?.style.visibility !== 'hidden' ? { control, plate } : null;
}

/**
 * Where the question grows from, read at each placement: off the selection card's far edge at its
 * delete control while the card shows, so it covers neither the card's row nor the thing being
 * deleted, and over the thing itself otherwise.
 */
function useQuestionAnchor(over: { x: number; y: number }, card: CardAnchor | null): { readonly x: number; readonly y: number } {
  const latest = useRef({ over, card });
  latest.current = { over, card };
  return useMemo(() => {
    const at = () => {
      const { over, card } = latest.current;
      const shown = shownCard(card);
      if (!shown) return over;
      const button = visualRect(shown.control), plate = visualRect(shown.plate);
      return { x: button.left + button.width / 2, y: card!.growUp ? plate.top : plate.bottom };
    };
    return { get x() { return at().x; }, get y() { return at().y; } };
  }, []);
}

export function DeletePopover() {
  const t = useT();
  const sel = useEditorStore((s) => s.deletePopover);
  const gridState = useEditorStore((s) => s.gridState);
  const executor = useEditorStore((s) => s.commandExecutor);
  const eventBus = useEditorStore((s) => s.eventBus);
  const card = useCardAnchor();
  // What the question stands over moves with the projection, and a pan or zoom closes it.
  const [, reproject] = useReducer((n: number) => n + 1, 0);
  useEffect(() => (sel ? onProjectionChange(eventBus, reproject, { objects: true }) : undefined), [sel, eventBus]);

  const dismiss = () => useEditorStore.getState().setDeletePopover(null);

  // What the question asks and where on screen its subject stands.
  let title = '';
  let confirm: (() => void) | null = null;
  let screenX = 0, screenY = 0;
  if (sel && gridState && executor) {
    const proj = getActiveView()?.projection;
    if (sel.kind === 'object') {
      const obj = gridState.objects.get(sel.id);
      if (obj) {
        const item = getCatalogItem(obj.catalogId);
        const size = getPlacedObjectSize(obj);
        const locale = useEditorStore.getState().locale;
        const box = proj && projectedBox(proj, { x: obj.position.x, y: obj.position.y, w: size.w, h: size.h });
        if (box) { screenX = box.x + box.w / 2; screenY = box.y - 8; }
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
        const box = proj && projectedBox(proj, { x: sel.x, y: sel.y, w: 1, h: 1 });
        if (box) { screenX = box.x + box.w / 2; screenY = box.y - 8; }
        title = t('delete.confirm_terrain');
        confirm = () => {
          peelTerrainAt(sel.x, sel.y);
          dismiss();
        };
      }
    }
  }
  const anchor = useQuestionAnchor({ x: screenX, y: screenY }, card);

  // Returned through AnimatePresence, the question stays mounted to play its exit.
  let content: ReactElement | null = null;
  if (confirm) {
    const asked = confirm;
    const fromCard = card?.control.current ? card : null;
    // A fingertip gets the card at its designed size at least, so its answers stay easy to tap.
    content = (
      <ChromeLifted key="popover" control={TOUCH_TARGET}>
        {({ zoom: chrome, weights }) => (
          <DeleteConfirmFace
            backId={DELETE_QUESTION_ENTRY}
            title={title}
            onCancel={dismiss}
            onConfirm={asked}
            anchor={anchor} trigger={fromCard?.control} prefer={fromCard?.growUp ? 'above' : 'below'} zoom={chrome}
            style={{ zoom: chrome, ...weights }}
          />
        )}
      </ChromeLifted>
    );
  }

  return <AnimatePresence>{content}</AnimatePresence>;
}
