import { createContext, useContext, useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) =>
    el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[inert], [aria-hidden="true"]')
    && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
}

interface Surface {
  id: symbol;
  parent: symbol | null;
  root: RefObject<HTMLElement | null>;
  trigger?: RefObject<HTMLElement | null>;
  onClose(): void;
  focus: 'menu' | 'contain' | 'none';
  outside: boolean;
  restore: boolean;
}

export const SurfaceOwner = createContext<symbol | null>(null);
const surfaces: Surface[] = [];

function belongsTo(child: Surface, ancestor: symbol): boolean {
  let parent = child.parent;
  while (parent) {
    if (parent === ancestor) return true;
    parent = surfaces.find((surface) => surface.id === parent)?.parent ?? null;
  }
  return false;
}

function focusMenu(surface: Surface, last = false): void {
  const root = surface.root.current;
  if (!root) return;
  const items = focusableWithin(root);
  const chosen = items.find((el) => el.getAttribute('aria-checked') === 'true');
  (last ? items[items.length - 1] : chosen ?? items[0])?.focus();
  if (!items.length) root.focus();
}

function onKeyDown(event: KeyboardEvent): void {
  const surface = surfaces[surfaces.length - 1];
  if (!surface || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopImmediatePropagation();
    surface.onClose();
    return;
  }
  const root = surface.root.current;
  if (!root || surface.focus === 'none') return;
  const items = focusableWithin(root);
  const at = items.indexOf(document.activeElement as HTMLElement);
  if (surface.focus === 'menu' && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  } else if (event.key === 'Tab') {
    if (surface.focus === 'menu') {
      // A portaled menu leaves through its trigger's document position, not the end of body.
      event.preventDefault();
      event.stopImmediatePropagation();
      const trigger = surface.trigger?.current;
      const owner = surfaces.find((entry) => entry.id === surface.parent)?.root.current;
      const siblings = focusableWithin(owner ?? document.body).filter((el) => !root.contains(el));
      const index = trigger ? siblings.indexOf(trigger) : -1;
      const target = siblings[(index + (event.shiftKey ? -1 : 1) + siblings.length) % siblings.length];
      surface.restore = false;
      surface.onClose();
      (target ?? trigger)?.focus();
    } else if (!items.length || at < 0 || (!event.shiftKey && at === items.length - 1) || (event.shiftKey && at === 0)) {
      event.preventDefault();
      ((event.shiftKey ? items[items.length - 1] : items[0]) ?? root).focus();
    }
  }
}

/** The click that completes a swallowed press, which must not reach what lies under it either. The
 *  surface has closed by the time it fires, so its listener outlives the surface stack. */
let swallowClickUntil = -Infinity;
let clickGuard = false;
/** A click this long after the swallowed press is a new press of its own. */
const CLICK_WINDOW_MS = 1500;

function onClick(event: MouseEvent): void {
  if (performance.now() > swallowClickUntil) return;
  swallowClickUntil = -Infinity;
  event.preventDefault();
  event.stopImmediatePropagation();
}

/**
 * A press outside the foreground floating surface only puts the surface away: the press and the
 * click it completes stop here, so nothing under them (the map, another control) acts on it.
 */
function onPointerDown(event: PointerEvent): void {
  const surface = surfaces[surfaces.length - 1];
  if (!surface?.outside || !(event.target instanceof Node)) return;
  if (surface.root.current?.contains(event.target) || surface.trigger?.current?.contains(event.target)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  swallowClickUntil = performance.now() + CLICK_WINDOW_MS;
  if (!clickGuard) {
    clickGuard = true;
    window.addEventListener('click', onClick, true);
    // A press that ends without a click (a drag) must not leave the guard armed for a later click.
    window.addEventListener('pointerup', () => { setTimeout(() => { swallowClickUntil = -Infinity; }, 0); }, true);
  }
  surface.onClose();
}

/** Portal key events reach React ancestors before the document's native listeners. */
export function routeSurfaceKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
  onKeyDown(event.nativeEvent);
  if (event.nativeEvent.defaultPrevented) event.stopPropagation();
}

/** React ownership follows portals; the foreground surface alone handles keyboard dismissal. */
export function useSurfaceScope({ open, onClose, root, trigger, focus = 'none', outside = false }: {
  open: boolean;
  onClose(): void;
  root: RefObject<HTMLElement | null>;
  trigger?: RefObject<HTMLElement | null>;
  focus?: Surface['focus'];
  outside?: boolean;
}): symbol {
  const parent = useContext(SurfaceOwner);
  const openerRef = useRef<HTMLElement | null>(null);
  const id = useRef(Symbol('surface')).current;
  const entry = useRef<Surface>({ id, parent, root, trigger, onClose, focus, outside, restore: true }).current;
  Object.assign(entry, { parent, root, trigger, onClose, focus, outside });
  useLayoutEffect(() => {
    if (!open) return;
    openerRef.current = trigger?.current ?? document.activeElement as HTMLElement | null;
    swallowClickUntil = -Infinity;
    entry.restore = true;
    const child = surfaces.findIndex((surface) => belongsTo(surface, id));
    if (child < 0) surfaces.push(entry);
    else surfaces.splice(child, 0, entry);
    if (surfaces.length === 1) {
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('pointerdown', onPointerDown, true);
    }
    let focusFrame = 0;
    const enter = () => {
      if (surfaces[surfaces.length - 1] !== entry) return;
      // A hidden surface cannot receive focus until its visibility reaches the DOM.
      if (root.current && getComputedStyle(root.current).visibility === 'hidden') {
        focusFrame = requestAnimationFrame(enter);
        return;
      }
      if (focus === 'menu' && !root.current?.contains(document.activeElement)) focusMenu(entry);
      else if (focus === 'contain' && root.current && !root.current.contains(document.activeElement)) (focusableWithin(root.current)[0] ?? root.current).focus();
    };
    enter();
    return () => {
      cancelAnimationFrame(focusFrame);
      const index = surfaces.indexOf(entry);
      if (index >= 0) surfaces.splice(index, 1);
      if (!surfaces.length) {
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('pointerdown', onPointerDown, true);
      }
    };
  }, [open, id, entry, focus, root, trigger]);
  useEffect(() => {
    if (!open) return;
    return () => {
      const opener = openerRef.current;
      // Restore after React's commit-time focus preservation has finished.
      if (entry.restore && opener?.isConnected && focus !== 'none') opener.focus();
    };
  }, [open, entry, focus]);
  return id;
}
