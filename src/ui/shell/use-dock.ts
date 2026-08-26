/*
 * use-dock.ts — whether the assistant's panel is DOCKED right now, which side it is docked at, and
 * neither of those is the same question as what is on screen this frame.
 *
 * THE PREFERENCE IS AN INTENT AND THE LAYOUT IS DERIVED FROM IT. Docking takes a strip of the window
 * for the column and stands the whole interface in what is left, so it needs a window wide enough
 * for both (`panel-frame.ts:hasPinRoom`, which is the fit floor's own arithmetic rather than a taste
 * number). A window that narrows past that stands the panel free again and REMEMBERS the intent, so
 * the dock comes back when the room does; the button reports the live state, and a press cannot ask
 * for a dock the window has no room for. THE SIDE IS PART OF THAT INTENT and is remembered with it.
 *
 * AND DOCKING IS A SEQUENCE, NOT A SWITCH, because the two things it does are not one move: the
 * floating panel LEAVES — with the character, as one unit, since they are one surface — and only then
 * does the sheet slide off the desk it was covering, revealing both aboard. So the answer has two
 * parts that are briefly out of step, and `useDockStage` is the one place they are kept.
 *
 * A CHANGE OF SIDE IS ONE CROSSING WITH A PASS THROUGH THE MIDDLE, and it has to be: the two forms
 * live on different layers and neither ever pretends to be the other, so there is no travel from one
 * end of the window to the other. The sheet comes back over the ground it is standing on, the ground
 * changes ends while the sheet covers the whole window and nothing is on screen to see it, and the
 * sheet leaves the other way. What keeps it ONE movement rather than two presses is that the middle is
 * not a stop: the two halves take `panel.pin.cross`'s own leave and landing, which accelerate into the
 * crossing and settle out of it.
 *
 * WHAT IS PUBLISHED IS HOW FAR THE SEQUENCE HAS GOT, NOT WHAT BEAT IT IS IN, and that inversion is
 * load-bearing. The desire (docked, side) is read from the store at RENDER, so a beat published from
 * an effect would always be one commit late — leaving exactly one painted frame in which the store
 * says "docked" and nothing says the sequence has not started, which is the panel at its docked
 * geometry before its floating exit begins. So the driver publishes `caughtUp`: the desire the
 * sequence has finished arriving at. Anything else is IN FLIGHT, and which beat that is follows from
 * the two answers by arithmetic every consumer does for itself.
 *
 * THE SLIDE IS ONE NUMBER, AND IT HAS TO BE. Moving the sheet moves three things that must agree to
 * the pixel: two plane insets and the FIT the whole interface is drawn at, since the strip the dock
 * takes is paid for by widening the fit's reference window (`design/scale.tsx:frameFit`). A css
 * transition can carry an inset and cannot carry a fit, and the two together read as the interface
 * shrinking first and sliding afterwards — measured, at the reference window, as a full step of scale
 * landing on frame one. So the fraction is animated ONCE here, on the declared motion, and every
 * surface multiplies its own distance by it (the pattern `design/ui-zoom-anim.ts` uses for the UI
 * scale, for the same reason). The GROUND'S OWN PARALLAX DRIFT is a fourth reader of that same
 * fraction (`panel-frame.ts:DOCK_PARALLAX`).
 *
 * AND ITS FRAMES ARE DELIVERED PAST REACT. The fraction is `dockAside`, a motion value the movers
 * subscribe to and turn into DOM style writes on its own change; React is told only when it CROSSES
 * an end, which is when a plane swaps between its travelling and its settled form. A fraction that
 * reached its surfaces as a render instead re-rendered the whole tree every frame (the fit's context
 * stands over the app), measured in Chrome 151 at 9-13ms of main thread per frame on an idle
 * machine — over the 8.3ms budget of a 120Hz display before the app has done anything else — and a
 * frame that ran over froze the sheet and leapt it half its travel in one step while the panel's own
 * WAAPI and compositor-carried beats played on beside it. Every engine runs style writes on the main
 * thread, so the headroom is cross-engine; which engine ran out of budget first was the only
 * divergence. A render that DOES land mid-flight is still honest: `useDockStage` reads the live
 * fraction at render, so React and the subscribers write the same styles at whatever the fraction is.
 *
 * Every surface that has to know reads it here — the fit's own widening (`App`), the two planes and
 * the offset the chrome stands over them by (`Shell`), the column's box (`agent/PanelColumn`), the
 * character's own presence and her rung (`agent/character/CharacterHost`).
 */
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { animate, motionValue, useReducedMotionConfig, type MotionValue, type Transition } from 'framer-motion';
import type { DockSide } from '../../core/runtime/prefs';
import { useEditorStore } from '../../state/store';
import { framerMotion, outMotion, outSeconds, seconds } from '../agent/motion';
import { useViewportSize } from '../design/scale';
import type { MotionId } from './motion/registry';
import { hasPinRoom } from './panel-frame';

/**
 * Whether this window has room for the dock, live.
 *
 * The SETTLED UI zoom, not the animated one: a Ctrl +/- glide that crosses the threshold would
 * otherwise dock and undock inside its own tween, and what the user asked for is the zoom they land
 * on.
 */
export function usePinRoom(): boolean {
  const { w } = useViewportSize();
  const uiZoom = useEditorStore((s) => s.uiZoom);
  return hasPinRoom(w, uiZoom);
}

/** Whether the panel is standing docked: asked for, open, and with the room for it. THE INTENT AS
 *  RESOLVED, which is what the control reports and what the sequence below is driven by — not
 *  necessarily what is on screen this frame. */
export function useAssistantDocked(): boolean {
  const pinned = useEditorStore((s) => s.assistantPinned);
  const open = useEditorStore((s) => s.assistantOpen);
  return usePinRoom() && pinned && open;
}

/** Which end of the window the dock is asked for at. Remembered while the panel is free, since that
 *  is the side the next dock takes. */
export function useDockSide(): DockSide {
  return useEditorStore((s) => s.assistantDockSide);
}

/**
 * WHERE THE PANEL'S PLATE WOULD STAND, and whether the sheet has moved off it. Not whether the panel
 * is OPEN — that is the column's own prop, and this answers only about the dock.
 *
 * `free` is over the map on the frame's grid and `ground` is the desk under the whole interface; the
 * two beats in between are documented on `place` itself. `sheetAside` is the sheet's own half — what
 * the two planes and the chrome's offset read — and it lags the intent by that exit on the way in and
 * leads it by the slide on the way back. `side` is which end the ground is at, which during a change
 * of side is the end it is LEAVING for as long as the sheet is still coming back over it.
 */
export interface DockStage {
  /**
   * WHERE THE PANEL'S PLATE STANDS, and the two middle answers are not one answer: whether a beat is
   * WATCHED decides whether what it does is a motion at all.
   *
   * `leaving` is the floating form playing its exit over a sheet that has not moved — somebody pressed
   * the dock and the going is the thing they are looking at. `folded` is the form simply not on screen:
   * the sheet has come back and is covering every part of the window, so a fold or a fade there is a
   * motion nobody can see, and the beat exists only to give the form that follows an honest entrance.
   * Played rather than taken instantly, `folded` is a whole floating panel painted over the covered
   * sheet for a frame before it starts to go.
   */
  place: 'free' | 'ground' | 'leaving' | 'folded';
  /** Where the sheet is HEADED: what the beats sequence and the control reports. */
  sheetAside: boolean;
  /** How far aside it is right now, 0 lying flat on the desk to 1 fully off it. THE ONE FRACTION every
   *  distance in the move is a multiple of, so the insets, the fit and the ground's own drift cannot
   *  land on different frames. Read LIVE at render and it does not cause one: a mover that needs every
   *  frame subscribes to `dockAside` itself, and a render that happens mid-flight gets the honest
   *  value rather than the one the last notification carried. */
  aside: number;
  /** Which end of the window the ground stands at, as the surfaces drawn against it must read it. */
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
