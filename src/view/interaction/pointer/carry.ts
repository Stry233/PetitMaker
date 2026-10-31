/**
 * An entry carried from a list onto the map: the one carry in progress, and the map views that can
 * take its drop.
 *
 * The list entry keeps the pointer captured from the press to the release, so no map view hears the
 * gesture as a press of its own. Each mounted pointer machine registers a target instead, and the
 * carry hands every move and the release to the one whose map is under the pointer: the move is the
 * active tool's hover there (its ghost and the cursor's refusal badge) and the release is a press and
 * release there, so a drop is the tool's own click. What the carry arms, and what it keeps or puts
 * back, is its caller's (`end`, told whether the release landed on a map, or came without the pointer
 * ever reaching one).
 */
import { clearCursorFacts } from './hover-probe';
import { pushCursorSurface, setCursorDrag } from '../cursor-controller';
import { holdEditInFlight } from '../../../state/edits-in-flight';

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
  /** The carry is over and its caller has settled the arming: the still pointer is sampled again
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
  /** The pointer has been over a map since the carry began. */
  reached: boolean;
  end: (dropped: boolean, stayed: boolean) => void;
  releaseCursor: () => void;
  /** Lets go of the carry's hold on the live map (`state/edits-in-flight.ts`), whose cancel puts the entry back. */
  releaseMap: () => void;
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

/** A release at `at` meant for `target`: one press and release of its tool when its map is what
 *  the point hits, nothing over anything else (a panel, the object bar, off the map). The carry's
 *  release and the release of a touch drag or hold with an item armed both end here; a quick tap
 *  places through the click path instead. True when the drop ran. */
export function dropAt(target: CarryTarget, at: CarrySample): boolean {
  if (!target.over(at.clientX, at.clientY)) return false;
  target.drop(at);
  return true;
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
  if (next) c.reached = true;
  setCursorDrag(next ? 'none' : 'object');
}

/** Ends `c` with `end` run before the targets hear it, so they settle against the arming it leaves;
 *  `dropped` is whether the release ran a target's drop, `released` whether a release ended it. */
function finish(c: LiveCarry, dropped: boolean, released = false): void {
  if (live === c) live = null;
  c.releaseMap();
  setCursorDrag('none');
  clearCursorFacts();
  c.releaseCursor();
  c.end(dropped, released && !c.reached);
}

/**
 * Starts carrying for `pointerId`; `surface` is the element holding the capture, which shows the
 * cursor while it does. `end` runs once, however the carry ends, before the map settles, with
 * `dropped` true only when the release landed on a map and ran its drop, and `stayed` true when a
 * release ended a carry whose pointer never reached a map. A carry already live is abandoned first.
 */
export function startCarry({ pointerId, surface, end }: {
  pointerId: number; surface: HTMLElement | null; end: (dropped: boolean, stayed: boolean) => void;
}): Carry {
  cancelCarry();
  const c: LiveCarry = { pointerId, under: null, reached: false, end, releaseCursor: pushCursorSurface(surface), releaseMap: () => {} };
  live = c;
  c.releaseMap = holdEditInFlight(() => { if (live === c) cancelCarry(); }, 'hand');
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
      let dropped = false;
      try {
        if (t) dropped = dropAt(t, at);
      } finally {
        finish(c, dropped, true);
        if (t) t.settle(at);
      }
    },
    cancel() {
      if (live !== c) return;
      retarget(c, null);
      finish(c, false);
    },
  };
}

/** Abandons the live carry with nothing changed; false when nothing is carried. */
function cancelCarry(): boolean {
  const c = live;
  if (!c) return false;
  retarget(c, null);
  finish(c, false);
  return true;
}
