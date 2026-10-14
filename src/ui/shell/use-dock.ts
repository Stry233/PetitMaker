/**
 * Resolves the saved dock intent against available width and coordinates the floating-panel exit,
 * sheet movement, and side changes. `dockAside` is one shared motion value for plane insets, frame
 * fit, panel geometry, and parallax; consumers subscribe directly so the app tree is not rendered on
 * every animation frame. The sequence publishes its last completed target, making any mismatch with
 * current intent an in-flight transition.
 */
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { animate, motionValue, useReducedMotionConfig, type MotionValue, type Transition } from 'framer-motion';
import type { DockSide } from '../../platform/storage/prefs';
import { useEditorStore } from '../../state/store';
import { framerMotion, outMotion, outSeconds, seconds } from '../design/motion';
import { useViewportSize } from '../design/scale';
import type { MotionId } from '../design/motion/registry';
import { hasPinRoom } from './panel-frame';
import { createSignal } from '../../core/base/signal';
import { useEffectEvent } from '../primitives/use-effect-event';

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
function useDockSide(): DockSide {
  return useEditorStore((s) => s.assistantDockSide);
}

/** Current dock sequence state. Panel visibility remains the caller's concern. */
interface DockStage {
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
 * How far the sequence has got. `reached` is null until the driver mounts (the store's desire is then the
 * stage); `done` counts the pending move's finished beats; `slide` is null until seeded; `slideEnd` is
 * the quantized fraction, the only reading of the slide React is notified of.
 */
let reached: DockWant | null = null;
let done: { want: DockWant; beats: number } | null = null;
let slide: number | null = null;
let slideEnd: 0 | 1 | 'between' | null = null;
const watchers = createSignal();

/** The one fraction, 0 flat on the desk to 1 fully off it; subscribers write styles directly, never through a render. */
export const dockAside: MotionValue<number> = motionValue(0);

function tellWatchers(): void {
  watchers.emit();
}

function subscribe(tell: () => void): () => void {
  return watchers.subscribe(tell);
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

/** How many beats of this pending move have finished. A desire the driver has not seen yet is at 0,
 *  which is what makes the first beat a derivation rather than a publication. */
function beatsDone(want: DockWant): number {
  return done !== null && same(done.want, want) ? done.beats : 0;
}

/**
 * One beat of a move: its stage and the declared motion carrying it; `half` picks that motion's leave or
 * landing, which the timer and the sheet's tween must both read.
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

/** The Framer transition the sheet runs on for a beat, which is the same half of the same declaration
 *  the timer above is reading. */
function beatTravel(motion: MotionId, half: 'out' | 'in'): Transition {
  return half === 'out' ? outMotion(motion) : framerMotion(motion);
}

/**
 * A move's beats in order: arriving at a dock is one beat; leaving one is two (the sheet covers, then the
 * floating form unfolds); a side change is two halves of one crossing, the ground changing ends while the
 * sheet covers it.
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
 * The sequence's driver, mounted once by the shell: each beat runs its motion's length, then the desire is
 * published as reached. A remembered dock opens docked; reduced motion lands before the paint.
 */
export function useDockDriver(): void {
  const docked = useAssistantDocked();
  const side = useDockSide();
  const reduced = useReducedMotionConfig() === true;
  const moving = useSyncExternalStore(subscribe, readMoving, readMoving);
  const from = moving.reached;

  // Mounting publishes the starting point and seeds the fraction to its end before any subscriber attaches.
  const seed = useEffectEvent(() => {
    if (reached !== null) return;
    dockAside.jump(docked ? 1 : 0);
    slide = docked ? 1 : 0;
    slideEnd = docked ? 1 : 0;
    reached = { docked, side };
    tellWatchers();
  });
  useLayoutEffect(() => {
    seed();
    return () => { reached = null; done = null; slide = null; slideEnd = null; };
  }, []);

  // Reduced motion lands before the paint, the fraction jumped here rather than a frame later.
  useLayoutEffect(() => {
    if (!reduced || from === null) return;
    if (inFlight(from, { docked, side })) {
      dockAside.jump(docked ? 1 : 0);
      reached = { docked, side };
      done = null;
      tellWatchers();
    }
  }, [reduced, from, docked, side]);

  // The running beat, read once for both the clock and the sheet.
  const beats = moving.done;
  const beat = from !== null && inFlight(from, { docked, side })
    ? beatsOf(from, { docked, side })[beatsDone({ docked, side })]
    : undefined;

  const beatMs = beat ? beatSeconds(beat) * 1000 : null;

  // One timer per beat: it hands the move its next beat or declares the desire reached.
  useEffect(() => {
    if (reduced || from === null || beatMs === null) return undefined;
    const want = { docked, side };
    const at = beatsDone(want);
    const timer = setTimeout(() => {
      if (at + 1 < beatsOf(from, want).length) done = { want, beats: at + 1 };
      else { reached = want; done = null; }
      tellWatchers();
    }, beatMs);
    return () => clearTimeout(timer);
  }, [reduced, from, beats, docked, side, beatMs]);

  // The slide chases the stage's own half, retargeting from where the sheet is on a second press; React
  // hears only about a crossing.
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
