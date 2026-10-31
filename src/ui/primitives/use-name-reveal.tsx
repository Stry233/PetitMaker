/**
 * The name of a control drawn as a glyph alone. In PC mode it rides the native `title`, which a
 * resting mouse shows; in touch mode, where nothing hovers, a hold shows it in a bubble hung from the
 * control (`useReveal`, `ControlBubble`), and the release ending that hold presses nothing.
 */
import { useRef, type FocusEvent, type PointerEvent, type ReactNode } from 'react';
import { useReveal, type RevealBind } from './use-reveal';
import { FloatingControlBubble } from './ControlBubble';

type NameBind = Omit<RevealBind, 'onPointerDown' | 'onPointerEnter' | 'onFocus'> & {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerEnter: (e: PointerEvent<HTMLElement>) => void;
  onFocus: (e: FocusEvent<HTMLElement>) => void;
};

/** Spread `bind` on the control and render `bubble` anywhere inside it: the bubble stands on the
 *  window's floating layer, hung from the control the reveal last met, so a clipping ancestor never
 *  cuts it. `side` is where it hangs where there is room. `title` is the hover title in PC mode where
 *  it says more than the name, such as the control's shortcut, and none where it is empty. */
export function useNameReveal(label: string, side: 'above' | 'below' = 'above', title: string = label): {
  bind: Partial<NameBind> & { title?: string };
  bubble: ReactNode;
} {
  const { shown, bind, touch } = useReveal();
  const anchor = useRef<HTMLElement | null>(null);
  if (!touch) return { bind: title ? { title } : {}, bubble: null };
  const named: NameBind = {
    ...bind,
    onPointerDown: (e) => { anchor.current = e.currentTarget; bind.onPointerDown(); },
    onPointerEnter: (e) => { anchor.current = e.currentTarget; bind.onPointerEnter(); },
    onFocus: (e) => { anchor.current = e.currentTarget; bind.onFocus(e); },
  };
  return { bind: named, bubble: <FloatingControlBubble show={shown} side={side} anchor={anchor}>{label}</FloatingControlBubble> };
}
