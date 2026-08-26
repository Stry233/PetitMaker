/*
 * CharacterHost.tsx — the one live character's HOME, and the app mounts exactly one of these.
 *
 * THERE IS ONE CHARACTER AND FREE SHE DOES NOT MOVE ON HER OWN AT ALL — THE PANEL SHE IS PART OF DOES
 * Her folded box and the desk's seat are both the frame's own placements
 * (`shell/panel-frame.ts`), and the offset between them is the whole floating form's displacement when
 * it is collapsed: opening, that form unfolds off her button and she is inside it the whole way. One
 * number carries both halves in one tick (`seat.ts:placeCarried`), so her place INSIDE the panel is the
 * difference of two seats and nothing else. She cannot live in either slot, since she positions herself
 * `fixed` from the slot's measured rect, so she lives here in a layer of her own, over the panel.
 *
 * AND A CHANGE OF DOCK IS NOT A CROSSING SHE MAKES AT ALL. The floating panel and the docked ground are
 * different layers, so she does not travel between them: she LEAVES the form being replaced and COMES
 * to the one replacing it, on a beat of her own (`seat.ts:popCharacter`), and the seat changes while she
 * is off screen or under the sheet. That hand-off is the only presence beat she has.
 *
 * THE SEAT IS WAITED FOR ON THE WAY IN AND THE INTENT ON THE WAY OUT, each off the one that is honest
 * for it. The panel is lazy, so its box arrives after the press (`seat.ts:setDeskSeat`, watched from
 * here) and a placement made at the press would have nowhere to land; the box then outlives the press by
 * the panel's own exit, so a seat read from the box going would be read after the panel had left. A
 * re-placement in the SAME seat — a window resize, a UI zoom, the sheet carrying the ground — puts both
 * halves back at the point the gesture had reached, which is the room moving rather than a move.
 *
 * SHE IS ALSO THE PRESS. The block under her draws no art of its own, and once the panel is open it
 * is covered by the panel, so this layer takes the pointer for her own box alone and the block below
 * keeps the label and the focus ring for a keyboard. The house hover applies to her too: a small
 * lift, so a pointer resting on her says she is a control before it is pressed.
 *
 * ONE THING STANDS WITH HER WHILE THE PANEL IS SHUT, and it belongs to this layer because it is
 * placed against the character rather than against the frame: the HERO CHIP, which carries the
 * running job's own word — with the panel folded, the character is the only evidence something is
 * editing the map. It ENTERS AND LEAVES with a transition and is never display-flipped: a chip
 * switched on by the fold's own timer appeared fully formed with no entrance at all, beside a panel
 * still folding, which is the spatial jump the prototype's `#charLayer` note records.
 *
 * THE LAYER STANDS OUTSIDE THE FRAME'S ZOOM, and that is a requirement rather than a preference.
 * `ui/shell/units.ts:ZOOM` is applied as a page-level `zoom` over the whole frame; a `fixed`
 * element inside a zoomed subtree resolves its own `left`/`top`/`width` in that zoomed space, while
 * `getBoundingClientRect` answers in real viewport px — so a character placed from a measured rect
 * inside the zoom would land at zoom times its own coordinates. Measured px in, unzoomed layer,
 * and the character comes out the size of the slot it was measured from at any zoom. For the same
 * reason nothing above it may carry a `transform` or a `filter`: either becomes the containing
 * block for the `fixed` character AND the offset parent its dust puff is placed against. Her OWN root
 * takes one (the pop's scale), which the puff is unreachable by — it is placed against her parent.
 *
 * IT POSES ITSELF, because the pose is a reading of the SESSION and the session runs whether or not
 * anyone has the panel open: a job started before the panel was put away still turns the character
 * at the entrance. The reading is the store's memoized `panelView`, the SAME object the panel
 * takes, so a streaming delta folds the log once for both rather than once each — the fold walks
 * the whole log, and this host re-renders on every one of those deltas. Sharing it is what makes
 * the read-tool set a module fact on the store (`setReadTools`) instead of a per-call argument:
 * this file is EAGER, the set derives from the tool schemas behind the panel's lazy boundary, and
 * two callers folding one log two ways can share nothing.
 */
import {
  useCallback, useEffect, useRef, useState, useSyncExternalStore,
  type CSSProperties, type RefObject,
} from 'react';
import { animate, AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { panelView, useAgentSession } from '../../../agent/session/store';
import { useT } from '../../../i18n/context';
import { useChromeScale } from '../../design/scale';
import { useDockStage } from '../../shell/use-dock';
import { cursors, font, z } from '../../design/styles';
import { INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { heroChipFace, useSecondClock } from '../dock-face';
import {
  amplitude, easingCss, framerMotion, landEasingCss, outEasingCss, outSeconds, overshootAt, seconds,
} from '../motion';
import { edge, statePaper } from '../tokens';
import { Character, getCharacterHandle } from './Character';
import { poseForPhase } from './poses';
import { useSurfacePose } from './surface-pose';
import { useCelebrateEdge } from './use-celebrate-edge';
import {
  carriedAlong, carryStep, deskSeat, parkCharacter, popCharacter, restingSeat, seatBox, setCarry,
  showCharacter, watchDeskSeat,
} from './seat';

/** The layer sits at the window's origin with no size of its own: the character positions herself
 *  `fixed`, and this is only what makes the layer her offset parent (the puff's own requirement) and
 *  what puts it over the panel she stands on. Over the frame, and DEAF as a layer — the two things in
 *  here that take a press (the character herself and the chip at her shoulder) turn it on for their
 *  own boxes, so nothing covers the window with a transparent sheet. */
const LAYER_STYLE: CSSProperties = {
  position: 'fixed',
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  zIndex: z.panel + 1,
  pointerEvents: 'none',
};

/** SEATED AT THE DOCKED DESK SHE GOES DOWN WITH IT. The docked panel is the GROUND the whole
 *  interface is a sheet of paper on (`design/styles.ts:z.ground`), and she is sitting at it — a
 *  character who kept her rung over the standing chrome would be drawn over the map while the sheet
 *  was still sliding off her. One step over the desk, which is the step she takes over the chrome. */
const GROUND_LAYER_STYLE: CSSProperties = { ...LAYER_STYLE, zIndex: z.ground + 1 };

/** The parked character's box in the layer's own space, which the chip is placed from. */
interface Parked { left: number; top: number; width: number; height: number }

/** The chip's own seat at the character's shoulder: a little inside her right edge, a little below
 *  her top, so it reads as pinned to her rather than floating beside her. */
const CHIP_IN = 6;
const CHIP_DOWN = 4;

/** How far the chip starts short of its own size, per its declaration. */
const CHIP_FROM = 1 - 0.3;

export interface CharacterHostProps {
  /** The folded box the character stands in while the panel is away, and the end she steps back to. */
  entranceRef: RefObject<HTMLElement | null>;
  /** Whether the panel is meant to be standing: what the chip at her shoulder is wanted for, and the
   *  half of her step that says she is LEAVING (the arriving half waits for the desk's own seat). */
  open: boolean;
  /** Is a provider key held: the one fact the phase cannot carry, and the difference between an idle
   *  desk and a sleeping one. */
  connected: boolean;
  /** The interface has been put away, so the character goes with the frame she stands on. */
  hidden?: boolean;
  /** The character's width before a slot is measured. Every placement sets one, so this only ever
   *  shows for the first frame. */
  size: number;
  /** Open the panel, which is what the chip is for: the way back into a job that is still running. */
  onOpen?: () => void;
  /** Fold the panel or unfold it: her own press, and the only one there is once the panel covers the
   *  block she stands on. Absent, she takes no pointer at all and the block below owns the press. */
  onToggle?: () => void;
}

export function CharacterHost({
  entranceRef, open, connected, hidden = false, size, onOpen, onToggle,
}: CharacterHostProps) {
  // WHICH DESK SHE IS AT, which decides the one thing about her that is not her own placement: her
  // rung. Read here rather than passed, since it is the same one answer every surface reads.
  const { place, sheetAside } = useDockStage();
  const t = useT();
  // The selector returns the SAME object while the store's (log, epoch, live) are unchanged, which
  // is what lets it stand as a store selector at all: the epoch is the store's own "something in
  // the log changed" counter, since the log is append-only and mutated in place, so its identity
  // cannot report an append.
  const view = useAgentSession(panelView);
  const celebrate = useCelebrateEdge(view);
  // A SURFACE OUTRANKS THE PHASE, and a one-shot moment outranks both: the setup screen's steps are
  // not a session state at all (see `surface-pose.ts`), and celebrating is an edge the phase cannot
  // express.
  const surface = useSurfacePose();
  const pose = celebrate ?? surface ?? poseForPhase(view.phase, { connected });
  const [parked, setParked] = useState<Parked | null>(null);

  // Both seats are placed by the frame, which moves with the WINDOW and with the user's UI ZOOM, so a
  // placement made once at mount goes stale. The window says so with a `resize`; the zoom says so
  // with nothing at all (it is a css `zoom` on the frame, which fires no event), so it comes in here
  // as a render input instead. It is the ANIMATED reading, so the character rides the glide rather
  // than jumping to the far end of it.
  const chromeScale = useChromeScale();
  // The desk's seat, while the desk is standing. A store rather than a prop: it lives behind the
  // panel's lazy boundary and registers itself, and this host is eager.
  const seated = useSyncExternalStore(watchDeskSeat, deskSeat, () => null);
  const reduced = useReducedMotionConfig() === true;
  // ONE DECLARATION FOR THE WHOLE GESTURE, since there is only one thing moving: the floating form
  // collapses onto her button and unfolds off it, and every track it has — the travel, the wipe, the
  // fade — reads this (`panel.open` / `panel.close`).
  const gesture = open ? 'panel.open' : 'panel.close';

  /**
   * WHERE THE ONE OBJECT STANDS, written for both halves of it at once (`seat.ts:placeCarried`).
   *
   * Her SEAT is the desk's while the panel is meant to be standing and her folded box otherwise; the
   * desk's box outlives the press by the panel's own exit, so a seat read from the box going would be
   * read after the panel had already left, while arriving it is the box that has to be waited for
   * (`open` is true before the lazy panel has a desk).
   *
   * THE TRAVEL IS MEASURED HERE AND NOWHERE ELSE, because this is the one place that can see both
   * boxes: the desk's seat inside the panel and her folded box in the frame. It is remembered with the
   * gesture's own progress, so a repaint between gestures re-places both halves at the point the last
   * frame reached rather than at an end.
   */
  const park = useCallback((along?: number) => {
    // HER SEAT IS THE DESK'S FOR AS LONG AS THERE IS A DESK, and the collapse is what takes her home
    // rather than a change of slot. Read from the intent instead, the seat flipped to her folded box in
    // the commit the press landed in — with the form not yet folded, which put her at the button beside
    // a panel still standing open.
    // THE DESK'S SEAT IS READ AT REST, because the slot travels inside the carriage and its measured
    // rect carries whatever the gesture has displaced it by (`seat.ts:restingSeat`). Her folded box
    // does not — it stands on the frame's own plane.
    const folded = seatBox(entranceRef.current);
    const seat = restingSeat(seatBox(seated)) ?? folded;
    // THE STEP IS THE PANEL'S, so it is only there while the panel HAS a seat; with her standing at her
    // folded box the two are the same box and the travel is nothing, which is exactly right.
    if (seat && folded) setCarry(along ?? carriedAlong(), carryStep(seat, folded));
    else if (along !== undefined) setCarry(along);
    const at = parkCharacter(seat);
    // HER HEIGHT IS THE DRAWING'S OWN — the placement sets a width and lets the art decide — so the
    // seat cannot answer for it and she is measured for it after being placed. The seat stands in
    // until the art has a box.
    const drawn = getCharacterHandle()?.el?.getBoundingClientRect();
    const height = drawn && drawn.height > 0 ? drawn.height : at?.width;
    if (at && height !== undefined) setParked({ ...at, height });
    // THE PLACE IS A PLACEMENT INPUT, and it has to be its own one. A dock change moves the desk to
    // the other end of the window without changing the ELEMENT the seat is: the panel is one component
    // at one key in both forms, so React reuses the node and a stable ref callback is never called
    // again — leaving her placed against a box that had moved the width of the window. `seated`
    // therefore cannot see a dock, and this can.
  }, [entranceRef, seated, place]);

  const parkNow = useRef(park);
  parkNow.current = park;

  /*
   * A PLACEMENT MADE WHILE THE RESIZE IS STILL BEING DISPATCHED READS THE OLD ROOM. The frame's zoom
   * is React state flushed in batches BETWEEN the window's resize listeners, so both triggers here
   * can run before the frame has re-laid out: the scale's own re-render lands in a flush the frame's
   * has not, and a listener registered by an effect is removed by that same flush and misses the
   * in-flight event outright (measured: she wore each window's placement one resize late). So every
   * trigger places her twice — once now, for the common case where the room already stands, and once
   * on the next frame, after every listener has run and the frame's own commit has landed.
   */
  const parkSettled = useCallback(() => {
    parkNow.current();
    if (typeof requestAnimationFrame !== 'function') return () => {};
    const frame = requestAnimationFrame(() => parkNow.current());
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => parkSettled(), [parkSettled, park, chromeScale]);
  // Mount-once, so no re-render can unhook it mid-dispatch. It also catches the one move the scale
  // cannot report: a height-only resize slides the panel's own top clamp without changing the fit.
  useEffect(() => {
    let settle = () => {};
    const onResize = () => { settle(); settle = parkSettled(); };
    window.addEventListener('resize', onResize);
    return () => {
      settle();
      window.removeEventListener('resize', onResize);
    };
  }, [parkSettled]);

  /**
   * THE GESTURE, ON ONE NUMBER.
   *
   * `panel.open` unfolds the form off her button and `panel.close` folds it back onto it, and the whole
   * of what either does is move this fraction: the carriage takes what is left of the collapse as a
   * transform and she is placed at her seat plus the same remainder, in the same tick, so there is
   * nothing for two clocks to disagree about. Interruptible — a press mid-fold retargets from where the
   * form is rather than from an end.
   *
   * DOCKED THERE IS NO GESTURE TO BE PART WAY THROUGH: the ground is revealed by the sheet and takes no
   * travel of its own, so the fraction is simply home. Reduced motion is the same answer arrived at in
   * one frame.
   */
  const away = place === 'leaving' || place === 'folded';
  // DOCKED, THE FRACTION IS SIMPLY HOME whatever the open intent says: the ground takes no gesture
  // travel — the sheet is the whole motion — and a collapse pressed over a dock reads as open=false
  // with the stage still at the ground. Read from the intent there, the carriage was handed the
  // fold's full displacement on the press: the window-tall ground teleported its whole step (measured
  // live: 472 x 119 px, at full opacity) and the sheet came back over an empty strip.
  const along = place === 'ground' || (open && !away) ? 1 : 0;
  useEffect(() => {
    if (reduced || place === 'ground' || place === 'folded') {
      parkNow.current(along);
      return undefined;
    }
    const run = animate(carriedAlong(), along, {
      ...framerMotion(gesture),
      onUpdate: (v: number) => parkNow.current(v),
    });
    return () => run.stop();
  }, [along, reduced, place, gesture]);

  /*
   * A CHANGE OF FORM IS THE ONE MOMENT SHE ARRIVES OR LEAVES ON HER OWN ACCOUNT, and there are three
   * of them:
   *
   *   `away`   — the form she was part of is being replaced. She goes, whichever form it was.
   *   `ground` — the docked desk has arrived, under a sheet that is still covering all of it. She
   *              comes, and the sheet then reveals a desk she is already sitting at.
   *   `free`   — the floating panel is back. She comes with it.
   *
   * FREE, THERE IS NOTHING HERE TO DO. Opening and closing the floating panel is the ONE object moving
   * (`seat.ts:placeCarried`), so `place` does not change and no beat fires: she is carried, not
   * announced.
   *
   * TIMED OFF THE PLACE CHANGING, not off the seat: the seat is what moves her, and this is about
   * whether she is on screen at all. Written after the placement effect above, so the frame that
   * seats her at the other end is the frame that decides whether she is visible in it.
   */
  // The pop in flight. A RUNNING ANIMATION OUTRANKS THE INLINE STYLE the writes below go to, so a
  // presence written while an older one is still playing is overridden until that one ends and then
  // snaps: docking straight from a folded panel showed her leave the ground she had just arrived on,
  // then reappear. Cancelled before every write, whichever way it goes.
  const popping = useRef<Animation | null>(null);
  const wasPlace = useRef(place);
  useEffect(() => {
    const from = wasPlace.current;
    wasPlace.current = place;
    if (from === place) return;
    popping.current?.cancel();
    popping.current = null;
    const to = away ? 0 : 1;
    // FOLDED, THERE IS NOTHING TO PLAY: she is under a sheet covering the whole window, so a beat there
    // is a beat nobody can see and its first frame is her standing where the form she just left was.
    if (reduced || place === 'folded') { showCharacter(to); return; }
    popping.current = popCharacter(to, {
      // A LEAVE IS THE LENGTH OF THE FORM'S OWN, and it has to be: the beat that carries it is the
      // floating exit (`shell/use-dock.ts`), so a longer departure would be cut off mid-way by the
      // arrival of the form replacing her.
      total: to === 1 ? seconds('panel.character.pop') : outSeconds('panel.character.pop'),
      easing: to === 1 ? easingCss('panel.character.pop') : outEasingCss('panel.character.pop'),
      land: landEasingCss('panel.character.pop'),
      from: 1 - (amplitude('panel.character.pop') ?? 0),
      past: overshootAt('panel.character.pop'),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place, reduced]);

  /*
   * THE SHEET MOVING CARRIES HER SEAT WITHOUT CHANGING IT, and that is a case a single placement
   * cannot answer: her FOLDED box stands on the sheet of interface, so when the sheet slides off the
   * dock (or back over it) that box travels for the length of `panel.pin.slide` while remaining the
   * same ELEMENT, and no crossing follows to re-read it.
   *
   * So she is re-placed every frame for the length of the slide, which is also what makes her RIDE
   * the sheet rather than jump to where it ended up. It is what carries her over the GROUND'S own
   * parallax drift as well: that is a transform on the column, so her seat's measured rect moves with
   * it and every frame of the follow reads the new one.
   */
  // ONLY WHILE THE SHEET IS ACTUALLY MOVING, and keyed on nothing else: re-placing her every frame is
  // what a follow is, and a loop hung on the placement callback's identity would run through the
  // floating gesture too, where the carriage is already carrying her.
  useEffect(() => {
    if (typeof requestAnimationFrame !== 'function') return undefined;
    const until = performance.now() + seconds('panel.pin.slide') * 1000;
    let frame = requestAnimationFrame(function follow(now) {
      parkNow.current();
      if (now < until) frame = requestAnimationFrame(follow);
    });
    return () => cancelAnimationFrame(frame);
  }, [sheetAside]);

  // The chip's clock is the job's own elapsed reading, so it ticks for as long as the chip stands —
  // and stops with it, rather than re-rendering this host once a second for the rest of the session.
  const chipWanted = !open && !hidden;
  const now = useSecondClock(chipWanted);
  const chip = chipWanted ? heroChipFace(view, now) : null;

  return (
    <div
      data-testid="character-layer"
      style={{
        ...(place === 'ground' ? GROUND_LAYER_STYLE : LAYER_STYLE),
        visibility: hidden ? 'hidden' : 'visible',
      }}
    >
      {/* SHE STANDS FREE. There is no plate behind her: the panel unfolds from her own corner, so
          what says she is a control is her hover and her press, and a card drawn around her while
          the panel was shut read as a second panel standing beside the one she opens. */}
      <Character
        pose={pose}
        size={size}
        {...(onToggle && !hidden ? { press: { onPress: onToggle, open } } : {})}
      />
      <AnimatePresence>
        {chip && parked && (
          <motion.button
            key="hero-chip"
            type="button"
            data-testid="hero-chip"
            onClick={() => onOpen?.()}
            initial={{ opacity: 0, scale: CHIP_FROM }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: CHIP_FROM }}
            transition={framerMotion('panel.chip.hero')}
            style={{
              position: 'absolute',
              left: parked.left + parked.width - CHIP_IN,
              top: parked.top + CHIP_DOWN,
              transformOrigin: '0 60%',
              // The one element in this layer that hears a press: the chip IS the way back into a
              // running job, and the layer around it stays deaf.
              pointerEvents: 'auto',
              cursor: cursors.clickable,
              whiteSpace: 'nowrap',
              background: statePaper.work,
              color: INK,
              border: edge,
              borderRadius: 999,
              padding: '4px 10px',
              ...roleFont('caption'),
              fontFamily: font.family,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {`${t(chip.wordKey)} ${chip.clock}`}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
