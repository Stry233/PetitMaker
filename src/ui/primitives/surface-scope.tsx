import { createContext, useContext, useEffect, useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { useTouchMode } from '../design/input-mode';
import { enterBack, holdBackKey, leaveBack, reachableRoot, routeBackKey, surfaceOrder, type BackEntry, type BackRank } from '../../platform/input/back-stack';
import { isComposingKey } from '../../platform/input/text-entry';

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && reachableRoot(el));
}

interface Surface {
  id: symbol;
  parent: symbol | null;
  root: RefObject<HTMLElement | null>;
  trigger?: RefObject<HTMLElement | null>;
  onClose(): void;
  focus: 'menu' | 'contain' | 'none';
  outside: boolean;
  /** A press outside puts the surface away and still acts on what lies beneath. */
  passes: boolean;
  /** A notice nobody asked for. */
  notice: boolean;
  rank: BackRank;
  restore: boolean;
  /** Backed out of and not yet closed by its owner. */
  backed: boolean;
  /** Its entry on the page's back stack while open. */
  back: BackEntry;
  /** The id of a state's own entry it takes the place of while open, so that state stands on the stack once. */
  backId?: string;
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

/** The surface the keyboard and a press outside reach: the first open one in the back stack's order
 *  (`surfaceOrder`), the one Escape ends, within reach unless `all`. */
function foreground(all = false): Surface | undefined {
  for (const entry of surfaceOrder(all)) {
    const surface = surfaces.find((s) => s.back === entry);
    if (surface) return surface;
  }
  return undefined;
}

/** Arrows and Tab within the foreground surface; Escape is the back stack's (`platform/input/back-stack.ts`). */
function onKeyDown(event: KeyboardEvent): void {
  const surface = foreground();
  if (!surface || event.defaultPrevented || isComposingKey(event)) return;
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
 * click it completes stop here, so nothing under them (the map, another control) acts on it. A
 * surface that `passes`, when no other outside-dismissed surface is open, is put away and the press goes on.
 */
function onPointerDown(event: PointerEvent): void {
  const surface = foreground();
  if (!surface?.outside || !(event.target instanceof Node)) return;
  if (surface.root.current?.contains(event.target) || surface.trigger?.current?.contains(event.target)) return;
  // Only alone: under another open surface the press would act while that surface still stands.
  if (surface.passes && surfaces.every((other) => other === surface || !other.outside)) { surface.onClose(); return; }
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

/** Portal key events reach React ancestors before the document's native listeners, so a portaled
 *  surface hands them to the back key and its own keys first. */
export function routeSurfaceKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
  routeBackKey(event.nativeEvent);
  onKeyDown(event.nativeEvent);
  if (event.nativeEvent.defaultPrevented) event.stopPropagation();
}

/** Surfaces opened, so each back entry takes an id of its own. */
let opened = 0;
let releaseBackKey: (() => void) | null = null;

/** The back stack's entry for `surface`: standing while open and not yet backed out of, within reach
 *  only while its root is, ending through its `onClose`. */
function backEntryOf(surface: Surface): BackEntry {
  return {
    id: surface.backId ?? `surface:${++opened}`,
    stands: () => !surface.backed,
    reachable: () => reachableRoot(surface.root.current),
    back: () => { surface.backed = true; surface.onClose(); },
    rank: () => surface.rank,
    surface: true,
    // A surface holding the keyboard (a menu, a question) keeps Delete; a notice or a card passes it on.
    deletes: () => (surface.notice || surface.focus === 'none' ? 'pass' : null),
    // Only a surface that holds the keyboard keeps the editor's keys out.
    root: () => (surface.focus === 'none' ? null : surface.root.current),
  };
}

/**
 * React ownership follows portals. Each open surface stands on the page's back stack, so Escape
 * closes it only while it is the newest state that stands (`rank` puts one under every other state or
 * over them all); the foreground surface alone takes the arrows and Tab. `outside` puts the surface
 * away on a press outside it; `'notice'` marks a surface nobody asked for (a hint bubble), which in
 * touch mode lets that press act beneath too, since a finger's tap on the map is the work the
 * notice must not cost. Delete passes over a surface that does not hold the keyboard.
 */
export function useSurfaceScope({ open, onClose, root, trigger, focus = 'none', outside = false, rank = 0, backId }: {
  open: boolean;
  onClose(): void;
  root: RefObject<HTMLElement | null>;
  trigger?: RefObject<HTMLElement | null>;
  focus?: Surface['focus'];
  outside?: boolean | 'notice';
  rank?: BackRank;
  /** The entry id of the state this surface shows (`editor/back/back-out.ts`), whose place it takes. */
  backId?: string;
}): symbol {
  const parent = useContext(SurfaceOwner);
  const openerRef = useRef<HTMLElement | null>(null);
  const id = useRef(Symbol('surface')).current;
  const touch = useTouchMode();
  const passes = outside === 'notice' && touch;
  const dismisses = outside !== false;
  const notice = outside === 'notice';
  const entry = useRef<Surface>(null as unknown as Surface);
  if (!entry.current) {
    const made = { id, parent, root, trigger, onClose, focus, outside: dismisses, passes, notice, rank, backId, restore: true, backed: false } as Surface;
    made.back = backEntryOf(made);
    entry.current = made;
  }
  const surface = entry.current;
  Object.assign(surface, { parent, root, trigger, onClose, focus, outside: dismisses, passes, notice, rank, backId });
  useLayoutEffect(() => {
    if (!open) return;
    const entry = surface;
    openerRef.current = trigger?.current ?? document.activeElement as HTMLElement | null;
    swallowClickUntil = -Infinity;
    entry.restore = true;
    entry.backed = false;
    entry.back = backEntryOf(entry);
    const children = surfaces.filter((other) => belongsTo(other, id));
    const child = children.length > 0 ? surfaces.indexOf(children[0]!) : -1;
    if (child < 0) surfaces.push(entry);
    else surfaces.splice(child, 0, entry);
    const childEntries = new Set(children.map((other) => other.back));
    enterBack(entry.back, (other) => childEntries.has(other));
    if (surfaces.length === 1) {
      releaseBackKey = holdBackKey();
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('pointerdown', onPointerDown, true);
    }
    let focusFrame = 0;
    const enter = () => {
      if (foreground(true) !== entry) return;
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
      leaveBack(entry.back);
      if (!surfaces.length) {
        releaseBackKey?.();
        releaseBackKey = null;
        document.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('pointerdown', onPointerDown, true);
      }
    };
  }, [open, id, surface, focus, root, trigger]);
  useEffect(() => {
    if (!open) return;
    return () => {
      const opener = openerRef.current;
      // Restore after React's commit-time focus preservation has finished.
      if (surface.restore && opener?.isConnected && focus !== 'none') opener.focus();
    };
  }, [open, surface, focus]);
  return id;
}
