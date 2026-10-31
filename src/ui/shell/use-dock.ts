/**
 * Resolves the saved dock intent against available width and coordinates the floating-panel exit,
 * sheet movement, and side changes. `dockAside` is one shared motion value for plane insets, frame
 * fit, panel geometry, and parallax; consumers subscribe directly so the app tree is not rendered on
 * every animation frame. The sequence publishes its last completed target, making any mismatch with
 * current intent an in-flight transition. The axis follows the layout shape: a wide window docks at a
 * side on the saved intent, an upright one always docks the open panel at its foot, as deep as the
 * seam's handle last left it.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { animate, cancelFrame, frame, motionValue, useReducedMotionConfig, type MotionValue, type Transition } from 'framer-motion';
import type { DockSide } from '../../platform/storage/prefs';
import { useEditorStore } from '../../state/store';
import { framerMotion, outMotion, outSeconds, seconds } from '../design/motion';
import { registerLiveDock, useViewportSize, type DockAxis, type DockRef } from '../design/scale';
import { viewportSizeSnapshot } from '../../platform/device/viewport-space';
import { useLayoutShape } from '../design/input-mode';
import type { MotionId } from '../design/motion/registry';
import { BOTTOM_DOCK, bottomDockDepth, dockStrip, keptDockShare, hasPinRoom, type DockEdge } from './panel-frame';
import { createSignal } from '../../core/base/signal';
import { useEffectEvent } from '../primitives/use-effect-event';

/** Whether the settled UI zoom leaves enough width for the dock. */
export function usePinRoom(): boolean {
  const { w } = useViewportSize();
  const uiZoom = useEditorStore((s) => s.uiZoom);
  return hasPinRoom(w, uiZoom);
}

/** The axis the dock takes its strip along: the foot of an upright window, a side of a wide one. */
export function useDockAxis(): DockAxis {
  return useLayoutShape() === 'portrait' ? 'y' : 'x';
}

/** Resolved dock intent; the transition may not yet have reached this state. */
export function useAssistantDocked(): boolean {
  const pinned = useEditorStore((s) => s.assistantPinned);
  const open = useEditorStore((s) => s.assistantOpen);
  const room = usePinRoom();
  const axis = useDockAxis();
  return open && (axis === 'y' || (room && pinned));
}

/** The edge the dock stands at: the saved side, retained while the panel is floating, or the foot of
 *  an upright window. */
function useDockEdge(): DockEdge {
  const saved: DockSide = useEditorStore((s) => s.assistantDockSide);
  return useDockAxis() === 'y' ? 'bottom' : saved;
}

/** The axis a dock edge takes its strip along. */
export function axisOf(edge: DockEdge): DockAxis {
  return edge === 'bottom' ? 'y' : 'x';
}

/** Current dock sequence state. Panel visibility remains the caller's concern. */
interface DockStage {
  /** `leaving` is visible; `folded` is hidden while the sheet covers the dock ground. */
  place: 'free' | 'ground' | 'leaving' | 'folded';
  /** Target sheet position. */
  sheetAside: boolean;
  /** Live shared fraction, from 0 (sheet over the ground) to 1 (sheet aside). */
  aside: number;
  /** Edge that currently owns the dock ground: a side, or the foot of an upright window. */
  edge: DockEdge;
}

/** What the sequence is arriving at, or has arrived at: the resolved intent, both halves. */
interface DockWant { docked: boolean; edge: DockEdge }

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

/** The depth a held seam handle drags the bottom dock to, as a share of the window's height, or null
 *  while nothing holds it. Per-frame writers read it beside `dockAside`; React never does, and the
 *  settled depth changes only on release. A drag let go under the close line stands until the dock's
 *  slide off has ended. */
export const dockDrag: MotionValue<number | null> = motionValue<number | null>(null);

/** Calls `write` once a frame while a held seam moves `dockDrag`, in the frame's render step, however
 *  often the pointer reports; a hold's end writes at once, so the settled depth lands before the paint. */
export function onDockDrag(write: () => void): () => void {
  let queued = false;
  const flush = () => { queued = false; write(); };
  const off = dockDrag.on('change', (held) => {
    if (held === null) {
      if (queued) { cancelFrame(flush); queued = false; }
      write();
      return;
    }
    if (queued) return;
    queued = true;
    frame.render(flush);
  });
  return () => { off(); if (queued) cancelFrame(flush); };
}

const dockHeldNow = () => dockDrag.get() !== null;
const watchHeld = (tell: () => void) => dockDrag.on('change', tell);

/** Whether a seam handle holds the bottom dock; React hears only the hold's start and end. */
export function useDockHeld(): boolean {
  return useSyncExternalStore(watchHeld, dockHeldNow, dockHeldNow);
}

/** How deep the handle last asked the bottom dock to reach, as a share of the window's height
 *  (`panel-frame.ts:BOTTOM_DOCK`), and the deepest the frame above it allows (`FrameLayout.leastHeight`,
 *  published by `frame-layout.tsx`). Settled values: the handle sets the first once on release and the
 *  plan the second when its least height changes, so their readers render only then. */
const asked = createSignal<number>(BOTTOM_DOCK.rest);
const ceiling = createSignal<number>(1);

/** Sets the depth the handle asks for, kept between the panel's least and most. */
export function setDockDepth(share: number): void {
  const next = keptDockShare(share);
  if (next !== asked.get()) asked.emit(next);
}

/** Sets the deepest share the frame leaves the bottom dock. */
export function setDockCeiling(share: number): void {
  if (share !== ceiling.get()) ceiling.emit(share);
}

function watchDepth(tell: () => void): () => void {
  const offAsked = asked.subscribe(() => tell());
  const offCeiling = ceiling.subscribe(() => tell());
  return () => { offAsked(); offCeiling(); };
}

/** The bottom dock's settled depth, for a writer outside a render: the asked depth within the frame's
 *  ceiling (`panel-frame.ts:bottomDockDepth`). */
export function dockDepthNow(): number {
  return bottomDockDepth(asked.get(), ceiling.get());
}

/** The deepest the handle may drag the seam to, as a share of the window's height. */
export function dockDepthMostNow(): number {
  return bottomDockDepth(BOTTOM_DOCK.most, ceiling.get());
}

/** The bottom dock's settled depth. */
export function useDockDepth(): number {
  return useSyncExternalStore(watchDepth, dockDepthNow, dockDepthNow);
}

const askedNow = () => asked.get();

/** The depth the handle last asked for, which the dock returns to once the frame lets it. */
export function useDockAsked(): number {
  return useSyncExternalStore(watchDepth, askedNow, askedNow);
}

/** The deepest the handle may drag the seam to, re-read as the frame's ceiling moves. */
export function useDockDepthMost(): number {
  return useSyncExternalStore(watchDepth, dockDepthMostNow, dockDepthMostNow);
}

/** The strip the dock takes from the window at its current fraction (`design/scale.tsx:DockRef`), which
 *  the app publishes for every fit. */
export function useDockRefValue(): DockRef {
  const { aside, edge } = useDockStage();
  const axis = axisOf(edge);
  const share = useDockDepth();
  const { h } = useViewportSize();
  const { size } = dockStrip(aside, h, axis === 'y' ? share : undefined);
  return useMemo(() => ({ axis, size }), [axis, size]);
}

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
  return a.docked === b.docked && a.edge === b.edge;
}

/** Whether the sequence still owes this desire a move. An edge change with the panel docked at
 *  neither end (a turn of the device while it floats or is closed) owes none. */
function inFlight(from: DockWant | null, want: DockWant): boolean {
  return from !== null && !same(from, want) && (from.docked || want.docked);
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
 * floating form unfolds); a side or axis change is two halves of one crossing, the ground changing ends
 * while the sheet covers it.
 */
function beatsOf(from: DockWant, want: DockWant): DockBeat[] {
  if (want.docked && !from.docked) {
    return [{
      stage: { place: 'leaving', sheetAside: false, edge: want.edge },
      motion: 'panel.close',
      half: 'in',
    }];
  }
  if (want.docked) {
    return [
      {
        stage: { place: 'ground', sheetAside: false, edge: from.edge },
        motion: 'panel.pin.cross',
        half: 'out',
      },
      {
        stage: { place: 'ground', sheetAside: true, edge: want.edge },
        motion: 'panel.pin.cross',
        half: 'in',
      },
    ];
  }
  return [
    {
      stage: { place: 'ground', sheetAside: false, edge: from.edge },
      motion: 'panel.pin.slide',
      half: 'in',
    },
    {
      stage: { place: 'folded', sheetAside: false, edge: from.edge },
      motion: 'panel.close',
      half: 'in',
    },
  ];
}

/** Where the panel stands and how far the sheet has moved, for any surface drawn against it. */
export function useDockStage(): DockStage {
  const want: DockWant = { docked: useAssistantDocked(), edge: useDockEdge() };
  const moving = useSyncExternalStore(subscribe, readMoving, readMoving);
  const beat = moving.reached !== null && inFlight(moving.reached, want)
    ? beatsOf(moving.reached, want)[beatsDone(want)]
    : undefined;
  const stage = beat?.stage
    ?? { place: want.docked ? 'ground' as const : 'free' as const, sheetAside: want.docked, edge: want.edge };
  return { ...stage, aside: slide ?? (stage.sheetAside ? 1 : 0) };
}

/**
 * The sequence's driver, mounted once by the shell: each beat runs its motion's length, then the desire is
 * published as reached. A remembered dock opens docked; reduced motion lands before the paint.
 */
export function useDockDriver(): void {
  const docked = useAssistantDocked();
  const edge = useDockEdge();
  const reduced = useReducedMotionConfig() === true;
  const moving = useSyncExternalStore(subscribe, readMoving, readMoving);
  const from = moving.reached;

  // Mounting publishes the starting point and seeds the fraction to its end before any subscriber attaches.
  const seed = useEffectEvent(() => {
    if (reached !== null) return;
    dockAside.jump(docked ? 1 : 0);
    slide = docked ? 1 : 0;
    slideEnd = docked ? 1 : 0;
    reached = { docked, edge };
    tellWatchers();
  });
  useLayoutEffect(() => {
    seed();
    return () => { reached = null; done = null; slide = null; slideEnd = null; dockDrag.set(null); setDockDepth(BOTTOM_DOCK.rest); };
  }, []);

  // Reduced motion lands before the paint, the fraction jumped here rather than a frame later; so does a
  // move a layout-shape flip makes, which turns the axis, since the shape's morph carries the panel from
  // the old dock to the new place (`ChromeMorph.tsx`).
  const turned = from !== null && axisOf(from.edge) !== axisOf(edge);
  useLayoutEffect(() => {
    if ((!reduced && !turned) || from === null) return;
    if (inFlight(from, { docked, edge })) {
      dockAside.jump(docked ? 1 : 0);
      reached = { docked, edge };
      done = null;
      tellWatchers();
    }
  }, [reduced, turned, from, docked, edge]);

  // The running beat, read once for both the clock and the sheet.
  const beats = moving.done;
  const beat = from !== null && inFlight(from, { docked, edge })
    ? beatsOf(from, { docked, edge })[beatsDone({ docked, edge })]
    : undefined;

  const beatMs = beat ? beatSeconds(beat) * 1000 : null;

  // One timer per beat: it hands the move its next beat or declares the desire reached.
  useEffect(() => {
    if (reduced || from === null || beatMs === null) return undefined;
    const want = { docked, edge };
    const at = beatsDone(want);
    const timer = setTimeout(() => {
      if (at + 1 < beatsOf(from, want).length) done = { want, beats: at + 1 };
      else { reached = want; done = null; }
      tellWatchers();
    }, beatMs);
    return () => clearTimeout(timer);
  }, [reduced, from, beats, docked, edge, beatMs]);

  // The slide chases the stage's own half, retargeting from where the sheet is on a second press; React
  // hears only about a crossing.
  const edgeNow = useRef(edge);
  useEffect(() => { edgeNow.current = edge; }, [edge]);
  useEffect(() => registerLiveDock({
    now: () => dockStrip(dockAside.get(), viewportSizeSnapshot().height, axisOf(edgeNow.current) === 'y' ? dockDrag.get() ?? dockDepthNow() : undefined),
    moving: () => { const at = dockAside.get(); return (at > 0 && at < 1) || dockDrag.get() !== null; },
    subscribe: (tell) => { const offSlide = dockAside.on('change', tell); const offDrag = onDockDrag(tell); return () => { offSlide(); offDrag(); }; },
  }), []);

  const target = useDockStage().sheetAside ? 1 : 0;
  const carry = beat?.motion ?? 'panel.pin.slide';
  const half = beat?.half ?? 'in';
  useEffect(() => dockAside.on('change', (v) => {
    slide = v;
    if (v <= 0 && dockDrag.get() !== null) dockDrag.set(null);
    const end = v <= 0 ? 0 : v >= 1 ? 1 : 'between';
    if (end !== slideEnd) { slideEnd = end; tellWatchers(); }
  }), []);
  useEffect(() => {
    if (reduced) { dockAside.jump(target); return undefined; }
    const run = animate(dockAside, target, beatTravel(carry, half));
    return () => run.stop();
  }, [target, reduced, carry, half]);
}
