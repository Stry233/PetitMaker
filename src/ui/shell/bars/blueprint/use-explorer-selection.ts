/**
 * The explorer's presses read for picking blueprints: which card a press or a drawn box meets, whether
 * a press repeats the last one, and the box a mouse draws over empty space, while what each selects
 * is `state/blueprint-explorer-selection.ts`'s. A taken card folds the explorer and arms it. Only the
 * selection is the store's; the anchor and the box are this view's.
 */
import { useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { timingFor, travelledPast } from '../../../../platform/input/gesture-timing';
import { clientPoint } from '../../../../platform/device/viewport-space';
import { boxBase, boxPicks, pressPicks } from '../../../../state/blueprint-explorer-selection';
import { visualRect } from '../../../design/visual-rect';
import type { BlueprintShelfModel } from './use-blueprint-shelf';

/** The attribute naming the blueprint a card or row of the explorer shows. */
export const BLUEPRINT_ID_ATTR = 'data-blueprint-id';

/** A box being drawn, in the drawing element's own px from its content's top left. */
interface DrawnBox { left: number; top: number; width: number; height: number }

interface Press { id: string; at: number }

/** The pointer type a click came from, empty where the browser does not say. */
const pointerTypeOf = (e: ReactMouseEvent): string => (e.nativeEvent as Partial<PointerEvent>).pointerType ?? '';

export function useExplorerSelection(model: BlueprintShelfModel, order: readonly string[], touch: boolean): {
  /** A card or row pressed. */
  press: (id: string, e: ReactMouseEvent) => void;
  /** Handlers for the scrolling view the cards stand in. */
  area: {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: () => void;
  };
  /** The box a mouse is drawing, or null. */
  box: DrawnBox | null;
} {
  const anchor = useRef<string | null>(null);
  const last = useRef<Press | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; base: readonly string[]; travelled: boolean } | null>(null);
  const [box, setBox] = useState<DrawnBox | null>(null);

  const press = (id: string, e: ReactMouseEvent) => {
    const at = e.timeStamp;
    const was = last.current;
    last.current = { id, at };
    const again = was?.id === id && at - was.at <= timingFor({ pointerType: pointerTypeOf(e) }).doubleTapMs;
    const out = pressPicks(
      { id, toggle: e.ctrlKey || e.metaKey, extend: e.shiftKey, repeat: e.detail >= 2 || again },
      { selected: model.selectedNow(), order, anchor: anchor.current, picking: model.picking, touch },
    );
    if ('take' in out) {
      last.current = null;
      model.take(id);
      return;
    }
    anchor.current = out.anchor;
    model.select(out.select);
  };

  /** The ids of the cards in `area` that the client-space box from `a` to `b` touches. */
  const touched = (area: HTMLElement, a: { x: number; y: number }, b: { x: number; y: number }): string[] => {
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    return Array.from(area.querySelectorAll<HTMLElement>(`[${BLUEPRINT_ID_ATTR}]`)).filter((el) => {
      const r = visualRect(el);
      return r.left < x1 && r.right > x0 && r.top < y1 && r.bottom > y0;
    }).map((el) => el.getAttribute(BLUEPRINT_ID_ATTR)!);
  };

  const area = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      // Only a mouse on the view's own empty space; a finger there scrolls.
      if (touch || e.pointerType === 'touch' || e.button !== 0 || e.target !== e.currentTarget) return;
      const p = clientPoint(e);
      drag.current = { id: e.pointerId, x: p.x, y: p.y, base: boxBase(e.ctrlKey || e.metaKey, model.selectedNow()), travelled: false };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const p = clientPoint(e);
      if (!d.travelled && !travelledPast(p.x - d.x, p.y - d.y, timingFor(e).dragThreshold)) return;
      d.travelled = true;
      const el = e.currentTarget;
      const r = visualRect(el);
      const k = el.offsetWidth > 0 ? r.width / el.offsetWidth : 1;
      const own = (q: { x: number; y: number }) => ({ x: (q.x - r.left) / k + el.scrollLeft, y: (q.y - r.top) / k + el.scrollTop });
      const a = own(d), b = own(p);
      setBox({ left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
      model.select(boxPicks(d.base, touched(el, d, p)));
    },
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      setBox(null);
      // A press on the empty space that drew no box selects nothing.
      if (!d.travelled) model.select([]);
    },
    onPointerCancel: () => { drag.current = null; setBox(null); },
  };

  return { press, area, box };
}
