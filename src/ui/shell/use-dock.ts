/**
 * Resolves the saved dock intent against available width and coordinates the floating-panel exit,
 * sheet movement, and side changes. `dockAside` is one shared motion value for plane insets, frame
 * fit, panel geometry, and parallax; consumers subscribe directly so the app tree is not rendered on
 * every animation frame. The sequence publishes its last completed target, making any mismatch with
 * current intent an in-flight transition.
 */
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { animate, motionValue, useReducedMotionConfig, type MotionValue, type Transition } from 'framer-motion';
import type { DockSide } from '../../core/runtime/prefs';
import { useEditorStore } from '../../state/store';
import { framerMotion, outMotion, outSeconds, seconds } from '../agent/motion';
import { useViewportSize } from '../design/scale';
import type { MotionId } from './motion/registry';
import { hasPinRoom } from './panel-frame';

/** Whether the settled UI zoom leaves enough width for the dock. */
export function usePinRoom(): boolean {
  const { w } = useViewportSize();
  const uiZoom = useEditorStore((s) => s.uiZoom);
  return hasPinRoom(w, uiZoom);
}

/** Resolved dock intent; the transition may not yet have reached this state. */
export function useAssistantDocked(): boolean {
  const pinned = useEditorStore((s) => s.assistantPinned);
  const open = useEditorStore((s) => s.assistantOpen);
  return usePinRoom() && pinned && open;
}

/** Saved dock side, retained while the panel is floating. */
export function useDockSide(): DockSide {
  return useEditorStore((s) => s.assistantDockSide);
}

/** Current dock sequence state. Panel visibility remains the caller's concern. */
export interface DockStage {
  /** `leaving` is visible; `folded` is hidden while the sheet covers the dock ground. */
  place: 'free' | 'ground' | 'leaving' | 'folded';
  /** Target sheet position. */
  sheetAside: boolean;
  /** Live shared fraction, from 0 (sheet over the ground) to 1 (sheet aside). */
  aside: number;
  /** Side that currently owns the dock ground. */
  side: DockSide;
}

/** What the sequence is arriving at, or has arrived at: the resolved intent, both halves. */
interface DockWant { docked: boolean; side: DockSide }

/**
 * How far the sequence has got, and the live slide.
 *
 * `reached` is null until the driver mounts, which is the answer a surface rendered before it needs:
 * nothing has moved, so the store's own desire IS the stage. `done` counts the beats of the pending
 * move that have FINISHED, which is what lets a move have more than one of them while the beat itself
 * stays a derivation — a fresh desire is at beat 0 by definition, so no publication is needed to say
 * the sequence has started. `slide` is null until the driver has seeded it, so a browser that opens
 * docked opens with the sheet already aside rather than sliding there. `slideEnd` is the QUANTIZED
 * fraction — an end, or between them — and it is the only reading of the slide React is notified of:
 * a per-frame value in the snapshot is a per-frame render of every subscriber.
 */
let reached: DockWant | null = null;
let done: { want: DockWant; beats: number } | null = null;
let slide: number | null = null;
let slideEnd: 0 | 1 | 'between' | null = null;
const watchers = new Set<() => void>();

/**
 * THE ONE FRACTION, 0 lying flat on the desk to 1 fully off it, as the live value the per-frame
 * movers subscribe to (`Shell`'s planes, the ground's drift). A subscriber turns a change into a DOM
 * style write of its own; nothing per-frame goes through a render.
 */
export const dockAside: MotionValue<number> = motionValue(0);

function tellWatchers(): void {
  watchers.forEach((tell) => tell());
}

function subscribe(tell: () => void): () => void {
  watchers.add(tell);
  return () => { watchers.delete(tell); };
}

/** One snapshot object per (reached, done, slideEnd) triple, so `useSyncExternalStore` is not handed
 *  a new identity on every read. */
interface Moving {
  reached: DockWant | null;
  done: { want: DockWant; beats: number } | null;
  slideEnd: 0 | 1 | 'between' | null;
}
let snapshot: Moving = { reached, done, slideEnd };
function readMoving(): Moving {
  if (snapshot.reached !== reached || snapshot.done !== done || snapshot.slideEnd !== slideEnd) {
    snapshot = { reached, done, slideEnd };
  }
  return snapshot;
}

function same(a: DockWant, b: DockWant): boolean {
  return a.docked === b.docked && a.side === b.side;
}

/** Whether the sequence still owes this desire a move. */
function inFlight(from: DockWant | null, want: DockWant): boolean {
  return from !== null && !same(from, want);
}

/** How many beats of THIS pending move have finished. A desire the driver has not seen yet is at 0,
 *  which is what makes the first beat a derivation rather than a publication. */
function beatsDone(want: DockWant): number {
  return done !== null && same(done.want, want) ? done.beats : 0;
}

/**
 * ONE BEAT OF A MOVE: what the stage is while it runs, and which declared motion carries it.
 *
 * `half` is which end of that declaration the beat takes, and it is the beat's length as much as its
 * curve: a motion split into a leave and a landing (`panel.pin.cross`) has a different shape and a
 * different length for each, and the timer and the sheet's own tween must read the same one or the
 * ground changes ends a frame after the sheet has finished covering it.
 */
interface DockBeat {
  stage: Omit<DockStage, 'aside'>;
  motion: MotionId;
  half: 'out' | 'in';
}

/** How long a beat runs: its motion's own length, the half it takes. */
function beatSeconds(beat: DockBeat): number {
  return beat.half === 'out' ? outSeconds(beat.motion) : seconds(beat.motion);
}

/** The Framer transition the SHEET runs on for a beat, which is the same half of the same declaration
 *  the timer above is reading. */
export function beatTravel(motion: MotionId, half: 'out' | 'in'): Transition {
  return half === 'out' ? outMotion(motion) : framerMotion(motion);
}

/**
 * THE BEATS OF A MOVE, in order.
 *
 * ARRIVING AT A DOCK IS ONE BEAT: the floating panel and the character play their exit over a sheet
 * that has not moved, and the ground is then simply revealed by the slide.
 *
 * LEAVING ONE IS TWO, and the second is what gives the returning panel an honest entrance. The sheet
 * comes back over the ground first; then the whole floating form stands FOLDED under a sheet that is
 * covering all of it, so what follows unfolds from her corner exactly as a press opens it rather than
 * standing there whole and wiping.
 *
 * A CHANGE OF SIDE IS TWO HALVES OF ONE CROSSING (`panel.pin.cross`, whose own entry carries why the
 * middle must not be a stop). The sheet returns over the end the dock is leaving, the ground changes
 * ends while the sheet covers every part of it — which is what makes the second half's stage the NEW
 * side with the sheet still flat — and the sheet then leaves the other way.
 */
function beatsOf(from: DockWant, want: DockWant): DockBeat[] {
  if (want.docked && !from.docked) {
    return [{
      stage: { place: 'leaving', sheetAside: false, side: want.side },
      motion: 'panel.close',
      half: 'in',
    }];
  }
  if (want.docked) {
    return [
      {
        stage: { place: 'ground', sheetAside: false, side: from.side },
        motion: 'panel.pin.cross',
        half: 'out',
      },
      {
        stage: { place: 'ground', sheetAside: true, side: want.side },
        motion: 'panel.pin.cross',
        half: 'in',
      },
    ];
  }
  return [
    {
      stage: { place: 'ground', sheetAside: false, side: from.side },
      motion: 'panel.pin.slide',
      half: 'in',
    },
    {
      stage: { place: 'folded', sheetAside: false, side: from.side },
      motion: 'panel.close',
      half: 'in',
    },
  ];
}

/** Where the panel stands and how far the sheet has moved, for any surface drawn against it. */
export function useDockStage(): DockStage {
  const want: DockWant = { docked: useAssistantDocked(), side: useDockSide() };
  const moving = useSyncExternalStore(subscribe, readMoving, readMoving);
  const beat = moving.reached !== null && inFlight(moving.reached, want)
    ? beatsOf(moving.reached, want)[beatsDone(want)]
    : undefined;
  const stage = beat?.stage
    ?? { place: want.docked ? 'ground' as const : 'free' as const, sheetAside: want.docked, side: want.side };
  return { ...stage, aside: slide ?? (stage.sheetAside ? 1 : 0) };
}

/**
 * THE SEQUENCE, DRIVEN. Mounted once, by the shell.
 *
 * Each beat runs for the length of the motion that carries it and the driver then publishes the
 * desire as reached, which is what hands the rest of the move to the settled answer. A browser that
 * opens with the dock remembered therefore opens docked with nothing animating, since the first
 * publication IS the desire and the fraction has never been moved. Reduced motion has no beats to be
 * in: the desire is reached in the same commit, before the paint, so both halves land in one frame.
 */
export function useDockDriver(): void {
  const docked = useAssistantDocked();
  const side = useDockSide();
  const reduced = useReducedMotionConfig() === true;
  const moving = useSyncExternalStore(subscribe, readMoving, readMoving);
  const from = moving.reached;

  // The driver's mount is what makes the sequence real: until it has published a starting point,
  // every surface reads the store's own desire and nothing is in flight. The fraction is seeded to
  // that desire's own end — before any subscriber is attached, so the seed is a fact and not a frame.
  useLayoutEffect(() => {
    if (reached === null) {
      dockAside.jump(docked ? 1 : 0);
      slide = docked ? 1 : 0;
      slideEnd = docked ? 1 : 0;
      reached = { docked, side };
      tellWatchers();
    }
    return () => { reached = null; done = null; slide = null; slideEnd = null; };
    // Seeded from the desire at mount and never re-seeded: the effects below own it after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // REDUCED MOTION HAS NO BEAT TO BE IN, and it lands before the paint rather than a frame later —
  // the fraction included, jumped HERE rather than in the passive effect below, because a passive
  // effect runs after the paint and the frame between would show the desire reached with the sheet
  // still where it was.
  useLayoutEffect(() => {
    if (!reduced || from === null) return;
    if (inFlight(from, { docked, side })) {
      dockAside.jump(docked ? 1 : 0);
      reached = { docked, side };
      done = null;
      tellWatchers();
    }
  }, [reduced, from, docked, side]);

  // WHICH BEAT IS RUNNING, once, for both the clock and the sheet: a timer measuring one half of a
  // declaration while the tween ran the other is how the ground comes to change ends a frame off the
  // sheet that is covering it.
  const beats = moving.done;
  const beat = from !== null && inFlight(from, { docked, side })
    ? beatsOf(from, { docked, side })[beatsDone({ docked, side })]
    : undefined;

  // ONE TIMER PER BEAT. Each runs for the length of the motion that carries it and then either hands
  // the move its next beat or declares the desire reached, which is what passes the rest of the move
  // to the settled answer.
  useEffect(() => {
    if (reduced || from === null || !beat) return undefined;
    const want = { docked, side };
    const at = beatsDone(want);
    const timer = setTimeout(() => {
      if (at + 1 < beatsOf(from, want).length) done = { want, beats: at + 1 };
      else { reached = want; done = null; }
      tellWatchers();
    }, beatSeconds(beat) * 1000);
    return () => clearTimeout(timer);
    // The beat is the (from, done, desire) triple resolved; those are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, from, beats, docked, side]);

  // THE SLIDE ITSELF, chasing whatever the stage's own half says — read through the stage so a beat
  // being reached is a re-render here too, and running on the beat's own half of its own declaration.
  // Interruptible by construction: a second press retargets from where the sheet is rather than
  // restarting from an end. The frames go to the fraction's own subscribers; React hears about a
  // CROSSING only, which is when a plane's travelling form and its settled form change places.
  const target = useDockStage().sheetAside ? 1 : 0;
  const carry = beat?.motion ?? 'panel.pin.slide';
  const half = beat?.half ?? 'in';
  useEffect(() => dockAside.on('change', (v) => {
    slide = v;
    const end = v <= 0 ? 0 : v >= 1 ? 1 : 'between';
    if (end !== slideEnd) { slideEnd = end; tellWatchers(); }
  }), []);
  useEffect(() => {
    if (reduced) { dockAside.jump(target); return undefined; }
    const run = animate(dockAside, target, beatTravel(carry, half));
    return () => run.stop();
  }, [target, reduced, carry, half]);
}
