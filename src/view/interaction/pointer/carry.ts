/**
 * An entry carried from a list onto the map: the one carry in progress, and the map views that can
 * take its drop.
 *
 * The list entry keeps the pointer captured from the press to the release, so no map view hears the
 * gesture as a press of its own. Each mounted pointer machine registers a target instead, and the
 * carry hands every move and the release to the one whose map is under the pointer: the move is the
 * active tool's hover there (its ghost and the cursor's refusal badge) and the release is a press and
 * release there, so a drop is the tool's own click. What the carry arms, and what it puts back, is
 * its caller's (`end`).
 */
import { clearCursorFacts } from './hover-probe';
import { pushCursorSurface, setCursorDrag } from '../cursor-controller';

/** One pointer position of the carry: a real `PointerEvent` satisfies it. `clientX`/`clientY` are
 *  the event's native coordinates. */
export interface CarrySample {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

/** A map view that can take a carried entry. */
export interface CarryTarget {
  /** Whether this view's map is what the native screen point hits. */
  over(clientX: number, clientY: number): boolean;
  /** The pointer is over this map: the tool previews what a press here would do. */
  hover(at: CarrySample): void;
  /** The pointer left this map, or the carry was abandoned over it: the preview goes. */
  leave(): void;
  /** The release landed on this map: one press and release of the tool here. */
  drop(at: CarrySample): void;
  /** The carry is over and its caller has put the arming back: the still pointer is sampled again
   *  against what is armed now. */
  settle(at: CarrySample): void;
}

/** The live carry's handle, driven by the list entry holding the pointer. */
export interface Carry {
  move(at: CarrySample): void;
  /** Drops onto the map under the pointer, or puts the entry back when no map is there. */
  release(at: CarrySample): void;
  /** Puts the entry back with nothing changed. */
  cancel(): void;
}

interface LiveCarry {
  pointerId: number;
  /** The target the pointer is over, the one showing the preview. */
  under: CarryTarget | null;
  end: () => void;
  releaseCursor: () => void;
}

const targets = new Set<CarryTarget>();
let live: LiveCarry | null = null;

/** Adds a map view's target for its life; returns the removal. */
export function registerCarryTarget(target: CarryTarget): () => void {
  targets.add(target);
  return () => {
    targets.delete(target);
    if (live?.under === target) live.under = null;
  };
}

/** Whether `pointerId` is carrying an entry, so a map view leaves its events to the carry. */
export function isCarried(pointerId: number): boolean {
  return live !== null && live.pointerId === pointerId;
}

function targetAt(at: CarrySample): CarryTarget | null {
  for (const t of targets) if (t.over(at.clientX, at.clientY)) return t;
  return null;
}

/** Points the preview at `next`, telling the target it left. Off the map the hand shows it is
 *  holding something a release there puts back; over the map the tool's own cursor and badge say
 *  what the drop does. */
function retarget(c: LiveCarry, next: CarryTarget | null): void {
  if (c.under === next) return;
  c.under?.leave();
  c.under = next;
  setCursorDrag(next ? 'none' : 'object');
}

/** Ends `c` with `end` run before the targets hear it, so they settle against the arming it puts
 *  back. */
function finish(c: LiveCarry): void {
  if (live === c) live = null;
  setCursorDrag('none');
  clearCursorFacts();
  c.releaseCursor();
  c.end();
}

/**
 * Starts carrying for `pointerId`; `surface` is the element holding the capture, which shows the
 * cursor while it does. `end` runs once, however the carry ends, before the map settles. A carry
 * already live is abandoned first.
 */
export function startCarry({ pointerId, surface, end }: {
  pointerId: number; surface: HTMLElement | null; end: () => void;
}): Carry {
  cancelCarry();
  const c: LiveCarry = { pointerId, under: null, end, releaseCursor: pushCursorSurface(surface) };
  live = c;
  setCursorDrag('object');
  const owns = (at: CarrySample) => live === c && at.pointerId === c.pointerId;
  return {
    move(at) {
      if (!owns(at)) return;
      const t = targetAt(at);
      retarget(c, t);
      t?.hover(at);
    },
    release(at) {
      if (!owns(at)) return;
      const t = targetAt(at);
      retarget(c, t);
      try {
        t?.drop(at);
      } finally {
        finish(c);
        if (t) t.settle(at);
      }
    },
    cancel() {
      if (live !== c) return;
      retarget(c, null);
      finish(c);
    },
  };
}

/** Abandons the live carry with nothing changed (Escape); false when nothing is carried. */
export function cancelCarry(): boolean {
  const c = live;
  if (!c) return false;
  retarget(c, null);
  finish(c);
  return true;
}
