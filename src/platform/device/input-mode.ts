/** The input mode (touch or PC) the editor follows: the last deliberate input decides, and never mid-gesture. */
import { modalityOf } from '../input/gesture-timing';
import { isTextEntry } from '../input/text-entry';

export type InputMode = 'pc' | 'touch';

type InputSample =
  | { kind: 'pointerdown'; pointerType: string }
  | { kind: 'pointerup'; pointersDown: number }
  | { kind: 'mousemove'; fromTouch: boolean }
  | { kind: 'wheel' }
  | { kind: 'key'; key: string; inTextField: boolean };

interface InputEnv {
  /** `(any-pointer: fine)` matches. */
  anyFine: boolean;
  maxTouchPoints: number;
}

/** Keys that are held alongside another input and say nothing about the device. */
const MODIFIER_KEYS: ReadonlySet<string> = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

/** Touch only on a device whose every pointer is coarse and that reports touch points. */
export function initialInputMode(env: InputEnv): InputMode {
  return !env.anyFine && env.maxTouchPoints > 0 ? 'touch' : 'pc';
}

/** The mode a sample votes for, or null when it carries no signal. */
function vote(sample: InputSample): InputMode | null {
  switch (sample.kind) {
    case 'pointerdown':
      return modalityOf(sample);
    case 'mousemove':
      // Browsers synthesise a mouse move after a tap; it is not a mouse.
      return sample.fromTouch ? null : 'pc';
    case 'wheel':
      return 'pc';
    case 'key':
      return sample.inTextField || MODIFIER_KEYS.has(sample.key) ? null : 'pc';
    case 'pointerup':
      return null;
  }
}

export class InputModeTracker {
  private current: InputMode;
  /** The latest vote, held until no pointer is down. */
  private pending: InputMode | null = null;

  constructor(initial: InputMode) {
    this.current = initial;
  }

  get mode(): InputMode {
    return this.current;
  }

  /** Takes a sample and the pointers down after it; returns the mode in force. */
  feed(sample: InputSample, pointersDown: number): InputMode {
    const v = vote(sample);
    if (v) this.pending = v;
    if (pointersDown === 0 && this.pending) {
      this.current = this.pending;
      this.pending = null;
    }
    return this.current;
  }
}

export function readInputEnv(): InputEnv {
  if (typeof window === 'undefined') return { anyFine: true, maxTouchPoints: 0 };
  const anyFine = typeof window.matchMedia === 'function' ? window.matchMedia('(any-pointer: fine)').matches : true;
  const maxTouchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0;
  return { anyFine, maxTouchPoints };
}

/** Compatibility mouse events follow touch and pen pointer events within this window. */
const TOUCH_MOUSE_WINDOW_MS = 800;

/** After the last pointer lifts, how long a switch waits for the click that release dispatches;
 *  a release with no click (a drag) switches once it passes. A press within the wait holds the
 *  switch until that press lifts. */
const CLICK_WAIT_MS = 300;

/** Follows the page's input from `initial` and reports each mode change; returns the stop function. A
 *  no-op without a window. A switch decided by a release is reported after that release's click has
 *  been dispatched, since the re-size can remove or move the element the click goes to. */
export function watchInputMode(onChange: (mode: InputMode) => void, initial: InputMode): () => void {
  if (typeof window === 'undefined') return () => {};
  const tracker = new InputModeTracker(initial);
  const down = new Set<number>();
  let lastNonMouse = -Infinity;
  let shown = initial;
  let wait: ReturnType<typeof setTimeout> | null = null;

  const report = (): void => {
    if (down.size > 0 || tracker.mode === shown) return;
    shown = tracker.mode;
    onChange(shown);
  };
  const endWait = (): void => {
    if (wait !== null) clearTimeout(wait);
    wait = null;
    window.removeEventListener('click', afterClick, true);
  };
  const settle = (): void => {
    endWait();
    report();
  };
  // Runs before the click reaches its target; the switch follows once its dispatch is over.
  function afterClick(): void {
    endWait();
    wait = setTimeout(settle, 0);
  }
  const feed = (sample: InputSample, lift = false): void => {
    tracker.feed(sample, down.size);
    if (wait !== null) return;
    if (lift && down.size === 0 && tracker.mode !== shown) {
      wait = setTimeout(settle, CLICK_WAIT_MS);
      window.addEventListener('click', afterClick, true);
      return;
    }
    report();
  };
  const noteNonMouse = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse') lastNonMouse = performance.now();
  };
  const lift = (e: PointerEvent): void => {
    down.delete(e.pointerId);
    noteNonMouse(e);
    feed({ kind: 'pointerup', pointersDown: down.size }, true);
  };
  const handlers: Array<[string, (e: never) => void]> = [
    ['pointerdown', (e: PointerEvent) => {
      // A new press holds a waiting switch until it lifts in turn.
      endWait();
      down.add(e.pointerId);
      noteNonMouse(e);
      feed({ kind: 'pointerdown', pointerType: e.pointerType });
    }],
    ['pointerup', lift],
    ['pointercancel', lift],
    // A hovering pen fires pointermoves, so its compatibility mouse moves stay inside the window.
    ['pointermove', noteNonMouse],
    ['mousemove', (e: MouseEvent) => {
      const caps = (e as MouseEvent & { sourceCapabilities?: { firesTouchEvents?: boolean } }).sourceCapabilities;
      const fromTouch = caps?.firesTouchEvents === true || performance.now() - lastNonMouse < TOUCH_MOUSE_WINDOW_MS;
      feed({ kind: 'mousemove', fromTouch });
    }],
    ['wheel', () => feed({ kind: 'wheel' })],
    ['keydown', (e: KeyboardEvent) => feed({ kind: 'key', key: e.key, inTextField: isTextEntry(e.target) })],
  ];
  // A pointerup can be lost (focus change, tab switch); without this the stale id blocks every switch.
  const release = (): void => {
    endWait();
    down.clear();
    feed({ kind: 'pointerup', pointersDown: 0 });
  };
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') release();
  };
  // An inert subtree takes no input from the reader, so an event aimed into one was dispatched by a
  // script (Help's pictured interface presses its own controls) and says nothing about the device.
  const fromReader = (fn: (e: never) => void) => (e: Event): void => {
    const target = e.target;
    if (typeof Element !== 'undefined' && target instanceof Element && target.closest('[inert]')) return;
    (fn as (e: Event) => void)(e);
  };
  const listening = handlers.map(([type, fn]) => [type, fromReader(fn)] as const);
  for (const [type, fn] of listening) window.addEventListener(type, fn, { capture: true, passive: true });
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    endWait();
    for (const [type, fn] of listening) window.removeEventListener(type, fn, { capture: true });
    window.removeEventListener('blur', release);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
